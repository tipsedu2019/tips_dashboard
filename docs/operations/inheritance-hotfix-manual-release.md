# Approved inheritance hotfix manual release — activation preparation

The final replacement product candidate is PR97 source
`1eccff3254b7024dc242bcffd11eb4505ff0700c`. The owner approved the presented
PR97 DB fix and subsequent application deployment with “진행해” at
2026-10-05 00:36:55 UTC, following the scoped proposal at
2026-10-04 23:00:53 UTC. The delegated release instruction binds that approval
to the exact source, SQL and runner fingerprints below and permits normal
reviewed runner CI integration and one conditional installation.

Installation is still INACTIVE: the copied envelope has `proposalOnly:true`
and `approvalReceiptSha256:null`, and the template is outside
`.github/workflows`. Approval does not prove that other database writers have
paused and drained. That operational confirmation is pending, so no executable
owner receipt has been created. The unchanged runner requires that confirmation
even for its read-only preflight. Registration CI, a hash-bound owner receipt,
and fresh TLS/ledger/catalog evidence are required before installation.
Application merge/deployment remains owned by the incident application thread
after a successful DB receipt; this runner does not deploy the product.

Source `947312688a4df79ea519b5c2f4ba39aa941670a1` and SQL SHA256
`946031a2c0a7e2d6688ccf808cc7f42dc2b1d47c206329339b622a5279aec6e0`
are STALE and superseded. Their five-new-function catalog, old permission packet
and historical runner/contract hashes must not authorize this replacement.

The exact canonical migration is
`supabase/migrations/20261004160000_legacy_effective_schedule_inheritance.sql`,
63,017 bytes, SHA256
`ca71cf8edc2135723c1a8e527ddbed5c285f6fb72da7a084966d8914597a9eb3`.
The fixed target is Seoul project `slnjqlzzhewblvttiidk` (`ap-northeast-2`).
No migration auto-versioning, alternate filename or ledger repair is allowed.

The replacement review packet records all three GitHub Actions jobs passing at
the exact source: `supabase-sql-review`, `supabase-schema-contract` and
`free-tier-guardrails`. It records 565 JavaScript tests, TypeScript, changed-file
ESLint and a production build passing. Exact-head Linux schema CI covered 82 SQL
files / 4,253 assertions and 12 wire/concurrency probes, including four actual
approval/cancellation races without duplicate approval events or provider calls.
Socket-only PostgreSQL 17 evidence at `963ccd19` used unchanged SQL/application
source: 18 role/spoof/RLS/DTO scenarios, 13 ACL assertions, 22 date/capacity
assertions, two source-projection assertions, one bounded-fixture bootstrap and
34 matching loaded function bodies. These are product evidence, not runner TLS
or production latency evidence. The local fixture is not a full Supabase/HTTP
auth or mutation-trigger clone. Vercel preview remains blocked with a FAILURE
status; three green GitHub jobs do not mean every PR status is green.

Draft ownership remains exactly five new files:

- `scripts/manual-inheritance-hotfix-install.py`
- `scripts/inheritance-hotfix-release-manifest.json`
- `tests/manual-inheritance-hotfix-install.test.py`
- `docs/operations/inheritance-hotfix-manual-release.md`
- `docs/operations/drafts/inheritance-hotfix-install.workflow.yml`

The transport is standalone, using the exact reviewed K CA/transport helper
copies with no runtime AI import, held AI workflow dependency or generalized
release framework. The current inactive proposal is frozen at these fingerprints;
they identify reviewed files, not owner approval or production readiness:

- Runner SHA256:
  `94493a4b14d6a99cde1e63c983be6e236135f06aa81a4433df36012730dabac9`.
- Unsigned contract SHA256:
  `f6dcf4d177af273f26d2d9da8360300a8249a47b5dce62f2afa2dc2d97675d03`.
- Proposal manifest SHA256:
  `8a1af42813b8bf8ac9810b89f75d943db892843cefdd568ece0ad24fdc048223`.
- Offline test SHA256:
  `ee96e9d8de9883c25b03b1380dc6a809822786fa9f034e70798492d7f687cb0a`.
- Inactive workflow template SHA256:
  `80f1f2c2847efa4859ccd1e45e7a4a06129f0b52d31c4bea286b51934554fb71`.

Controlled cached Python 3.12.14 with an `env -i` environment passed all 30 offline
unit tests in 0.190 seconds. The corrected catalog assertion distinguishes the
thirteen SQL declaration targets from eleven actual catalog changes and verifies
the two old DTO RPCs remain exactly unchanged. Units exercised functions including
`main` under mocks; no production entrypoint, live preflight/install, CA-only flag,
real API, DB, CLI or credential handling ran. Current Python AST/JSON and Ruby
Psych YAML parsing passed; all ten helper copies remain exact. Final independent
runner/manifest/test/workflow scope review is complete at the four pinned file
hashes. Semantic actionlint and activation/registration CI remain pending.
Actual TLS and fresh ledger are unknown.
No executable owner receipt has been created, and no GitHub secret, right or
credential setup was added. In the isolated activation checkout, all five frozen
file hashes matched before edits and the unchanged 30-test offline suite passed
again in 0.191 seconds. A fresh GitHub read confirmed main
`010c36d27a76b2fdb8f78edec99d7c3c9bbbd1b0`, the exact PR97 head and the three
required successful checks. The generic DB workflow is isolated validation;
there were no queued or in-progress workflow runs at that read. Those facts do
not establish application, cron, worker or manual-writer quiescence.

The migration creates nine functions and replaces four. The expected catalog
below requires exact before/final hashes, owner/attributes and ACLs in the new
runner oracle; the old five-function preflight is insufficient. The fourteen-entry
oracle includes these thirteen functions and the unchanged writer, with language,
return type, function kind and returnsSet as well as security/volatility/ACLs.
Expected owner is `postgres` and search_path is empty.
`dashboard_private.makeup_effective_date_key_v1(text)` returns `date`; the other
thirteen observed catalog entries return `jsonb`.

| Function | Change | Security / volatility | authenticated / service_role EXECUTE |
|---|---|---|---|
| `dashboard_private.resolve_legacy_effective_schedule_v1(jsonb)` | New | INVOKER / immutable | Denied / denied |
| `dashboard_private.legacy_effective_binding_v1(jsonb)` | New | INVOKER / immutable | Denied / denied |
| `dashboard_private.legacy_effective_context_v1(public.classes,jsonb)` | New | INVOKER / stable | Denied / denied |
| `dashboard_private.legacy_effective_input_v1(jsonb,jsonb,jsonb,integer,integer)` | New | INVOKER / immutable | Denied / denied |
| `dashboard_private.makeup_effective_date_key_v1(text)` | New | INVOKER / immutable | Denied / denied |
| `dashboard_private.legacy_effective_context_for_dates_v1(public.classes,jsonb,date,date)` | New | INVOKER / stable | Denied / denied |
| `dashboard_private.read_makeup_operating_reference_v1(date,date)` | New | DEFINER / stable | Denied / denied; owner-only scoped reader |
| `dashboard_private.makeup_effective_class_context_v1(jsonb)` | New | DEFINER / stable | Approved allowed / allowed; conditional activation pending |
| `public.get_makeup_effective_occupancy_v1(jsonb)` | New | INVOKER / stable | Approved allowed / allowed; conditional activation pending |
| `dashboard_private.read_timetable_operating_reference_v1()` | Replace | DEFINER / stable | Denied / denied, unchanged |
| `public.get_class_schedule_v1(uuid,date,date)` | Replace | DEFINER / volatile | Allowed / allowed, unchanged |
| `public.get_makeup_approval_collision_context_v1(jsonb)` | Replace | INVOKER / stable | Denied / allowed, unchanged |
| `public.get_makeup_reservation_context_v1(jsonb,uuid[])` | Replace | INVOKER / stable | Allowed / allowed, unchanged |

PUBLIC and anon are denied on these functions. Private source helpers remain
inaccessible to authenticated/service callers, including the new scoped DEFINER
reader. The public INVOKER wrapper calls the occupancy DEFINER. The three new
permission decisions are creation of the owner-only scoped private DEFINER,
authenticated/service_role EXECUTE on the occupancy DEFINER, and the same EXECUTE
on its public INVOKER wrapper. The latter two signatures are the entire new client
EXECUTE surface. All three decisions require explicit action-time owner approval
and are not covered by an earlier AI installation receipt.

The occupancy DEFINER requires a non-null `auth.uid()` or current role
`service_role`. It adds no staff-role, active-profile or class-ownership gate;
viewer, assistant and unlinked authenticated users receive the same occupancy
surface if this grant is approved. The assistant's existing workspace restriction
and request/event RLS remain intact. The DTO contains only `id`, `classId`,
`className`, `date`, `startMinute`, `endMinute`, `classroom`, `uncertain` and
`allRooms`, with no students, raw plans, rich source adapters or approval payloads.
No owner, schema/table grant or role-membership widening is included. Locked
approval mutation, cancellation, idempotency and no-send boundaries are preserved.

One occupancy RPC accepts at most 14 distinct KST day envelopes within 14 inclusive
KST days, with canonical UTC startAt/endAt strings. Empty/invalid input is handled
before the scoped source reader. Date filtering precedes normalized aggregation;
legacy resolution and eligible approval-source materialization are date-scoped,
while complete identity/date counts and class basics remain available for the
inheritance rules. Effective-date and overlap filtering precede a 2,001st-row
sentinel: more than 2,000 final occupancy rows raises exact SQLSTATE `22023`,
message `makeup_effective_capacity_exceeded`, without a truncated successful DTO.

Browser and approval callers split arbitrary total request sizes into sequential
batches, preserving every covered date and actual original interval. There is no
new total lesson-count limit, parallel fan-out or automatic retry. All batches
share the existing eight-second read deadline/cancellation; a partial failure
publishes no successful context. This does not prove DB cancellation. Multiple
RPCs are not one database snapshot; unchanged final locked approval guards remain
authoritative.

The resource boundary is material to the proposed authenticated EXECUTE grant:
history JSONB plans/snapshots still require scanning/detoasting for
date/identity/eligibility, complete class basics/catalogs are read, and dense
in-window sources can be large. The 2,000-row cap is response capacity, not a DB
execution-work budget or benchmark. A dense batch fails closed. No production
latency result or resolution of the reported hang is claimed.

Immediate action-time SELECT-only preflight must confirm the target, TLS, full
canonical inventory, exact ledger count/latest/version hash and the new
before/final function catalog, including absence of all nine new signatures.
Historical evidence established five absences; the four additional new signatures
also need fresh absence checks. Historical production evidence was 362 rows,
latest `20261002170849`, sorted-version/LF SHA256
`63d5517028ceb647b242b24edba0957fd6ce010fb3abc762a6dfef363733f93b`;
it was not refreshed by this replacement review. Only if that exact prerequisite
and the reviewed inventory are freshly confirmed may the single missing canonical
version plan expect 363 rows, latest `20261004160000`, sorted-version/LF SHA256
`1edeca0dfb3d8a32c4f29b4c467d30ca25ba8ce77cee1a8ab62ee5e8d841def3`.
Any different count/version/hash/catalog stops the release for review; the runner
must not adapt or repair it.

Snapshots select only allowlisted catalog metadata, body hashes, counts and
booleans, never function bodies or business rows. The unchanged August writer
`dashboard_private.notification_makeup_payload_v1(uuid,uuid,text)`, historical
body MD5 `ff4f02efcca4d52b159a7b9edd934dd5`, needs exact unchanged body/metadata/ACL
confirmation. The runner never invokes schedule/collision projections,
approval/cancellation RPCs or business functions, even in rollback transactions.

Transport preserves checkout-relative `supabase/certs/prod-ca-2021.crt`, PEM
SHA256 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`,
regular/non-symlink/hash/UTC-validity checks before secrets and at runtime, and the
same absolute CA for psql `PGSSLROOTCERT` and native CLI `sslrootcert`. Preserve
verify-full, official project/session-pooler metadata, fixed Seoul host/tenant and
port 5432. No CA/path override, runtime CA fetch or global trust change is allowed.
Existing credentials remain in the reviewed secure execution path; no credential
extraction, new keys or passwordless CLI initialization.

After final runner review and an explicit owner receipt, a dedicated runner may
invoke pinned native CLI 2.115.0 at most once with a password-free direct DSN,
child-only PGPASSWORD and `--skip-vault`. It retains the single canonical
filename/version and authored BEGIN/COMMIT, with no include-all, alternate
migration views, seeds or role/vault writes. SQL COMMIT can precede the native
ledger INSERT; DDL plus ledger are not atomic. Any command failure, partial
application, ambiguity, changed prerequisite or postflight mismatch stops without
retry, ledger repair or automatic rollback.

All other DB writers must be explicitly paused and confirmed for the install
window; workflow concurrency cannot lock unrelated writers. Receipt bound
`maxInstallDispatches=1` is one-dispatch authorization, not durable replay
prevention. A failed or ambiguous attempt requires fresh review and authority
before any retry.

The manifest remains a public inactive envelope with `proposalOnly:true`,
`sourceReviewStatus:'reviewed_current'` and `approvalReceiptSha256:null`.
The proposal/receipt gates must stop before
credential handling, source/transport operations, API or DB. `CONTRACT_SHA256`
covers only `contract`, encoded as UTF-8 canonical JSON using `sort_keys=True`,
`separators=(',', ':')` and `ensure_ascii=True`; the script pins that digest.
The envelope's proposal flag and receipt hash remain outside it. A future receipt
binds exact product/SQL/target/catalog/ledger, the three new permission decisions
including two client EXECUTE grants and DTO/resource scope, and reviewed
script/unsigned-contract/CA pins. It must not hash a
final manifest containing its own hash. The contract must not hash its pinning
script or this document. Later activation pins an immutable reviewed runner
commit and files without a commit self-reference. Old, placeholder or AI receipts
cannot authorize this release. Workflow activation and exact-path/full-hash
registration are separate reviewed changes after CI and the new owner receipt.

The following retained owner-review outline records the frozen reviewed scope;
the approval evidence is recorded at the top of this document. Execution remains
conditional on activation/
registration CI, a new owner receipt, fresh action-time TLS/ledger/catalog
evidence and confirmed paused writers:

> Approve secure SELECT-only TLS/target/ledger/catalog preflight for source
> `1eccff3254b7024dc242bcffd11eb4505ff0700c` and canonical SQL
> `20261004160000` / SHA256
> `ca71cf8edc2135723c1a8e527ddbed5c285f6fb72da7a084966d8914597a9eb3`,
> and, only after exact fresh prerequisites and all other DB writers being
> confirmed paused, ONE explicit native-CLI install dispatch to Seoul
> `slnjqlzzhewblvttiidk`. Approve new owner-only SECURITY DEFINER
> `dashboard_private.read_makeup_operating_reference_v1(date,date)` without
> authenticated/service_role EXECUTE, and approve EXECUTE for those roles only on
> new `dashboard_private.makeup_effective_class_context_v1(jsonb)` SECURITY
> DEFINER and `public.get_makeup_effective_occupancy_v1(jsonb)` INVOKER wrapper;
> source helpers and scoped reader remain private. Accept the reviewed 14-envelope/
> 14-inclusive-KST-day/2,000-output-row boundary, residual history scans/detoasting,
> shared eight-second client deadline without DB-cancel proof, and multi-RPC
> snapshot limit. Bind the new reviewed script/contract/catalog/ledger/CA pins in
> the owner receipt, `maxInstallDispatches=1`, with no retry after failed or
> ambiguous attempts without fresh review/authority. This excludes product merge/
> deployment/UI smoke, business RPCs, data repair, rollback, PR96 and AI migrations.

No receipt is issued by this outline. The incident application thread owns the
approved subsequent application deployment and authenticated UI evidence after
a successful DB receipt; business outcome verification belongs to an authorized
human. Rollback source is 23,344 bytes, SHA256
`e057be0af5c417b9094adadebe68e07110c311f10a9c29f6a175b94e3f550a77`,
source-reviewed only, not executed/validated. Recovery remains forward-only:
after inherited-field writes, restoring function definitions does not necessarily
restore old semantics. Do not rewrite raw plans or claim rollback-safety proof.

PR96 source `37a4298f77af2fe91ea20ba335a74249383cd990` and lower versions
`20261004140438` / `20261004140440` are excluded. A later separately validated
out-of-order canonical path is required, without ledger repair or blind include-all.
Disposable PostgreSQL 17 tests of baseline→PR96 pair→PR97 and baseline→PR97→PR96
may be planned separately; no such execution is authorized here. Installing this
hotfix invalidates the AI product93 runner's frozen 362→369 baseline; coordinate
a separately reviewed new baseline before that runner resumes.

Required release evidence remains separate:

| Validation | Required evidence / current boundary |
|---|---|
| Product source | Final `1eccff3` exact SQL/date bounds and all three GitHub jobs passed; Vercel preview remains blocked. Old947/946 is superseded. |
| Runner freeze and offline checks | Current five fingerprints above; controlled Python 3.12.14 `env -i` offline units 30/30 PASS in 0.190s, AST/JSON/Psych YAML PASS and ten exact reviewed helper copies. The fourteen-entry catalog covers thirteen SQL targets and unchanged writer, with two old DTO RPCs verified exactly unchanged. Final runner/manifest/test/workflow scope review is complete; semantic actionlint and activation/registration CI remain pending. Units called `main` under mocks; no production entrypoint/live preflight/install/CA-only flag or real API/DB/CLI ran. |
| Disposable PostgreSQL 17 / native CLI | Exact before/final catalog/body hashes/ACLs and canonical inventory/ledger behavior with no authentication fallback; product bounded-runtime evidence is not native installation evidence. No business RPCs or rollback proof by the runner. |
| Runtime TLS/ledger/catalog preflight | Approved immediate secure SELECT-only TLS/target/full inventory and fresh exact before-ledger/catalog evidence, conditional on the required receipt and CI. Historical 362 rows are not current authority; no live preflight has run. |
| One install dispatch | Explicit owner-only scoped DEFINER plus two-signature client EXECUTE/resource-scope approval, new hash-bound receipt and all other DB writers confirmed paused; one dispatch only, ambiguity stops. |
| Product / recovery | Deployment/UI/human business verification are separate decisions; forward recovery without automatic rollback or raw-plan repair. |
