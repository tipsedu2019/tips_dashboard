# Shared DB migration history alignment — 2026-09-09

## Cause and recovery

[Main DB run 34334014236](https://github.com/tipsedu2019/tips_dashboard/actions/runs/34334014236)
passed its repository preflight but stopped with
`transactional_preflight_remote_history_drift` before running transactional SQL.
The shared project `slnjqlzzhewblvttiidk` had one worksheet migration applied by
the English Studio project after the dashboard's preceding successful release.
Dashboard main had 306 migration versions; the remote ledger had 307.

Restore the already-applied SQL into the dashboard migration directory under
the **remote identity**, without changing its bytes or editing the remote ledger.
This follows the existing exact-hash external migration mirror convention.

| Evidence | Value |
| --- | --- |
| Applied version / name | `20260909091156` / `worksheet_history_summaries` |
| Dashboard mirror | `supabase/migrations/20260909091156_worksheet_history_summaries.sql` |
| English Studio source at inspection | `supabase/migrations/20260909071003_worksheet_history_summaries.sql` |
| Remote statement count / UTF-8 bytes | 1 / 1112 |
| Remote statement and source MD5 | `a5cd551f5b486dd43ce7504deb9f36a0` |
| Source and mirror SHA-256 | `92106ceb036738069cc999da847fc022b5c8dc42bbcc2791ca9d390eadb1d196` |

The English source and restored dashboard file compare byte-for-byte equal.
The live view also matches the recorded SQL: `security_invoker=true`,
SELECT denied to `anon` and `authenticated`, SELECT granted to `service_role`.
It projects V2, non-deleted worksheet metadata and item counts. It does not expose
the full `project_snapshot`; server callers must retain organization and creator filters.

## Verification and safeguards

- Read-only remote/local version comparison after restoring the file:
  **307 local / 307 remote; remote-only 0; local-only 0**.
- Building the production transactional preflight against that comparison yields
  **0 pending migrations**. The view SQL is not replayed.
- The migration layout verifier and its independent test constants pin the
  canonical file's SHA-256 and reject the source project's differing timestamp
  if it appears in the dashboard migration directory.
- The isolated dashboard runner recognizes the exact file as externally applied,
  like the other worksheet mirrors. This does not claim that the dashboard's
  reduced test baseline installs or tests the English Studio view.
- Regression coverage checks missing-history rejection, no replay after alignment,
  continued rejection of an unknown remote version, and altered-file/wrong-version
  rejection by the isolated runner.
- No remote `migration repair`, ledger deletion/rewrite, new DDL, student-data
  mutation, or real notification send is part of this recovery.

## Shared-project handoff

For future migrations applied by either project, capture the actual remote
version, name, and SQL after application and mirror that identity in the other
repository before its next DB release. A source filename timestamp may differ
from the version assigned by the remote application tool; do not submit both as
separate migrations. Keep unknown-history rejection enabled and compare SQL
before restoring a missing mirror. This change does not modify the English
Studio repository.

CI completion is recorded by the fixing PR's required checks and the subsequent
main `Push Supabase Migrations` run. The old failed run remains as incident
evidence; rerunning its old SHA would retain the missing file.
