# Bounded manual AI-agent database release

This manual runner installs only the seven canonical migrations for product source
`93b2b34646ad1ceb16989a4eceb33f2b44651ed1` on Seoul project
`slnjqlzzhewblvttiidk`. The immutable owner receipt records the action-time approval
at 2026-10-04T09:55:33.769499Z. Existing `SUPABASE_ACCESS_TOKEN` and
`SUPABASE_DB_PASSWORD` stay in GitHub Actions; never extract, print or copy their
values. This authorization excludes new credentials, provider/env/space setup,
schedulers and actual Chat sending.

The bootstrap is noncircular: reviewed commit B contains the runner, exact
369-file attestation, owner/read-only receipts and offline tests; commit C adds
the separately reviewed workflow pinning B. Both are integrated through an
operations PR before dispatch. The product checkout remains the approved SHA
above. A changed product base requires fresh product-head CI and independent
review before product merge. Operations integration does not install SQL.

Dispatch defaults to `preflight` with acknowledgement
`READ ONLY PRODUCTION PREREQUISITE CHECK`. It verifies the immutable source,
provided existing password, official project/primary session-pooler metadata,
certificate/hostname, original 362-version ledger hash and zero target objects
in an explicit READ ONLY transaction, then exits before CLI initialization.
Install mode additionally requires acknowledgement
`INSTALL ONLY SEVEN REVIEWED MIGRATIONS`, the exact hash-bound owner receipt,
and three successful GitHub Actions checks for the approved product source.

Install invokes pinned native Linux CLI 2.115.0 once with a password-free direct
libpq DSN, child-only `PGPASSWORD`, `sslmode=verify-full` and `--skip-vault`.
Canonical migration filenames and authored transaction boundaries are preserved.
No alternate migration view, include-all, repair, seed, roles, vault write,
automatic retry or automatic containment is permitted. Authored COMMIT can
precede the CLI ledger INSERT; any partial or unknown state stops the attempt.
A fresh attempt still requires the untouched original ledger and zero AI objects.
Other migration writers must remain paused; workflow concurrency cannot control
other executors.

Successful postflight requires exact 369-version ledger and final seven names,
21 RLS tables, 48 functions, expected RPC ACLs, three validated deferred FKs,
issuance OFF, all seven Chat slots unconfigured and zero credentials/permissions/
domain grants. It emits only a safe count/boolean/hash receipt. No raw CLI output,
function body or credential is retained. Output-limit and timeout handling kills
and reaps only the owned child group, then stops without retry.

The approved contingency is separately reviewed revocation of application-role
EXECUTE on the exact seven new public wrappers, preserving objects, data, audit,
ledger and FKs. It is never called by this runner and is not a database rollback.
The production restore point remains unverified. Actual TLS/authentication,
installation, application deployment and authenticated UI smoke require their
own runtime evidence; offline tests do not establish those outcomes.

The earlier passwordless CLI history read failed, and retained evidence cannot
conclusively rule out writable temporary-role initialization. No further
passwordless CLI attempt is permitted. This runner requires the existing
explicit database password and uses the separately reviewed direct connection
path.
