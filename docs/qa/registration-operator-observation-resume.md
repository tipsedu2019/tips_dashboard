# Registration operator and observation candidate

This is the single integration of the preserved registration candidate with main
`1c2159d6924596072ab7fda76fbf24458e384b4b` (PR144, including PR143). It is ready
for the existing Mac operator to retrieve and validate, not for deployment.

## Current Mac handoff: audit-preserving race lifecycle

Use the next exact commit supplied on the same branch. The existing Mac task
reported Node22 12/12 PASS and native PG17.6 parsing of all3 sessions for
`fa0327113eede9653936bb01a091f71b3964c193`. Case1 observed its wait/completion and
one-row verification, then teardown failed on
`dashboard_audit_logs_class_id_fkey`. Case2 setup failed; cases3-7 did not start.
The complete lifecycle result is0/7 PASS, not a successful race case. Exit1,
stdout1851B and stderr1569B were retained; the exact failing DELETE and SQLSTATE
were not recorded. Receipt SHA256:
`dcf330aeea6de2da799d0fbe6f14392af753b0c97a10f35ed7b6985ee2142101`.
New postdeploy was true, cleanup5 empty, and source725 unchanged, as reported by
the parent. These are Mac results, not additional cloud executions.

The source audit explains a deterministic failure path. Migration
`20260728230427_continuous_class_schedule_release2_contracts.sql` adds the audit
class FK with ON DELETE SET NULL. The final
`20260814115116_dashboard_audit_diff_format.sql` still attaches an AFTER DELETE
class trigger that derives audit_class_id from OLD.id and inserts a new audit
row. Existing rows can be detached by the FK action, but the new audit row then
references the removed class. Deleting old audit rows first cannot fix that
path. This is a source-confirmed mechanism; the old runtime report does not
identify its exact statement/SQLSTATE. Product audit functions/FKs are unchanged.

The fixture now creates its five common synthetic resource rows once: auth
account, profile, class, teacher catalog and classroom catalog. They and their
audit history remain inside the owned disposable DB until that entire DB is
removed. This lifecycle avoids audited parent deletion; it does not disable
triggers, alter product constraints, delete audit history or change product RLS.
A private fixture state table has RLS enabled and no client-role grants.

Before creating case data, setup snapshots the complete five rows, their audit
rows and every direct FK child row that references their IDs. It discovers these
FKs from pg_constraint, uses quoted identifiers and a bound UUID, and rejects
unsupported dependency shapes. Later setups require an identical snapshot and
the expected previous lifecycle count; they never silently overwrite resources.
Task data and result/baseline tables are recreated separately for every case.

Teardown deletes only the eight scoped synthetic tasks, whose existing cascades
remove tracks/details/enrollments/events and mutation receipts. It flushes all
deferred constraints, asserts zero scoped business residue, compares the full
resource/audit/FK snapshot, and rechecks the six no-send counts. It then requires
two worker results for the next exact case number, advances the lifecycle count,
clears JWT and drops the per-case fixture schema. Each successful checkpoint
emits `registration_guard_race_case_cleaned:N`. Failure emits only cleanup phase,
SQLSTATE and constraint name, then rethrows the original error. Retained anchors
and all remaining synthetic audit history are removed by the owned DB's final
disposal, whose cleanup evidence remains required.

All3 session declarations/bodies, all26 steps, all7 permutations, `capture`,
`assert_case`, wait/completion checks, output parser and timeouts are unchanged.
Cloud Node24.19.0 passed14 race source/parser tests, including the official-grammar
subset checks, snapshot/lifecycle boundaries and a check of the final ordered
migration's audit/FK definitions. The new anchor regression rejects the old
embedded spec. These are source checks; no cloud DB query or race was executed.

Hand this single candidate and its manifest/spec pins to the existing Mac task
`01a13a32-3a3b-77ca-a490-88ee40d720ad`. Use a fresh owned disposable DB and the
existing verified runtime/wrapper/context checks. Run the changed race contract
and actual race7; reuse source-matched SQL127, SQL6, Linux10 and unchanged
source725 evidence. Do not reuse the old failed DB or remove retained anchor rows
manually. The focused source command remains:

```bash
node --test --test-reporter=tap tests/registration-enrollment-race-probe.test.mjs
```

Require all7 waits/completions/verifications, cleanup notices1-7, successful
teardowns, original zero exit and final owned-resource cleanup5 empty. If any
phase fails, retain the non-sensitive phase/SQLSTATE/constraint diagnostic and
original exits; do not substitute a partial-case success for lifecycle7/7.
Actual race and final release gates remain pending. No deployment or operational
mutation was performed. Exact source and schema pins are recorded in
`registration-operator-observation-race-audit-lifecycle-evidence.json`.

## Historical Mac handoff: session teardown grammar correction

Use the next exact commit supplied on the same branch. The Mac operator reported
that predecessor `4eb4b562870c950937a1d67f0293a96b6cebf27e` passed Node22 race
contracts10/10 and a fresh postdeploy gate. Actual PostgreSQL17.6 isolationtester
then rejected spec line288 during parsing: exit1, no signal, stdout0B/stderr25B,
zero executed permutations. Receipt SHA256:
`1677ed295b75d1648f02dd3691738a87a725ff3891aca7e9412d5b2483848e99`.
The parent also confirmed unchanged source724, reusable SQL127/SQL6/Linux10 and
cleanup5 PASS. These are reported Mac results, not new cloud executions.

The official session production places optional setup before one or more steps
and optional teardown after them. All three session teardowns were before their
first steps. They now follow `a_commit`, `b_commit` and `verify_director_fk`.
These three relocations are the entire spec change. Every SQL block body,
all26 step bodies, all7 permutation lines, cleanup bodies and their relative
order remain byte-identical. The embedded spec and its SHA256 are synchronized;
probe executable logic, lock waits, output checks and timeouts are unchanged.

The complete current spec was compared with the exact
[PG17.6 grammar](https://raw.githubusercontent.com/postgres/postgres/REL_17_6/src/test/isolation/specparse.y)
and [scanner](https://raw.githubusercontent.com/postgres/postgres/REL_17_6/src/test/isolation/specscanner.l):
one global setup, one global teardown, three sessions, one setup and teardown per
session, step counts10/9/7, and seven explicit permutations referencing all26
defined steps. The audit covers token boundaries, comments, quoted identifiers,
first-closing-brace SQL blocks, declaration order, cardinality and end of input.
This spec uses no blocker/notices syntax.

A narrow source validator now checks the grammar subset actually used here,
failing closed on unused syntax. It is not the PostgreSQL parser and does not
parse SQL. Regression coverage rejects18 malformed variants: premature teardown
in each session, the prior brace-literal problem, duplicate/misplaced declarations,
missing steps/identifiers, unknown or empty permutations and incomplete/trailing
input. The full-structure test fails on the predecessor. Cloud Node24.19.0 passed
all12 race source/parser tests after correction, with zero failures/skips.

The existing Mac task `01a13a32-3a3b-77ca-a490-88ee40d720ad` should retrieve this
single candidate and bind the new HEAD/spec/source pins to its verified wrapper
and owned disposable PostgreSQL17 context. Run the changed race contracts and
actual race7 through the existing approved path. Retain ownership, nonce,
CWD/UID/config and postdeploy prerequisites; reuse only source-matched passing
evidence. SQL127, SQL6, Linux10 and unchanged source724 do not need repetition.
The focused contract command remains:

```bash
node --test --test-reporter=tap tests/registration-enrollment-race-probe.test.mjs
```

Record actual parser success, three sessions, seven permutations, seven observed
waits/completions, seven verification results and original exits. Source parsing
checks do not certify PostgreSQL execution. Product SQL/RLS and operational data
are unchanged. Actual race and final required release checks remain pending;
no deployment was performed. See
`registration-operator-observation-race-grammar-evidence.json` for input hashes,
regression results and provenance.

## Historical Mac handoff: race scanner correction only

Use the new exact commit supplied in this handoff on the same branch. The Mac
operator reported that predecessor `2e5e6c735aa5f72f2a2b1c784ae2f81a25711df4`
passed Node22 15/15, guarded-save SQL127 and postdeploy. The remaining race run
failed at specification parsing: child exit1, no signal, stdout0B/stderr50B,
zero executed cases. Diagnosis receipt SHA256:
`e35b516b062792708189604df03c555b322c0efb034616ce6ab806a75b7ff419`.
These are reported Mac results, not additional cloud executions.

The exact PostgreSQL17.6 scanner treats a closing brace as the end of an SQL
block without interpreting SQL string quoting. The empty-object literal on
spec line33 therefore ended setup prematurely. The fixture now constructs the
same empty JSON object with `jsonb_build_object()::text`. This is the only spec
change; its embedded copy and SHA256 are synchronized. See the
[official PostgreSQL17.6 scanner](https://raw.githubusercontent.com/postgres/postgres/REL_17_6/src/test/isolation/specscanner.l).

The new source regression fails on the predecessor and passes after correction.
Cloud Node24.19.0 passed all10 race source/parser tests with zero failures/skips.
All26 steps, all7 permutation lines and the complete probe executable logic are
byte-identical to the predecessor. SQLSTATE expectations, role/RLS restrictions,
lock waits, timeouts, no-send and cleanup assertions remain intact. The guarded
SQL, product migration, isolated runner and postdeploy SQL are unchanged.

Hand the new exact HEAD and manifest/spec pins to the existing Mac validation
task `01a13a32-3a3b-77ca-a490-88ee40d720ad`. Rebind the existing verified wrapper
and owned disposable PostgreSQL17 context, preserving nonce/CWD/UID/config and
existing gate prerequisites. Repeat only the changed race contract and actual
race7 execution; do not repeat the passed whole Node suite or guarded SQL127.
The focused contract command is:

```bash
node --test --test-reporter=tap tests/registration-enrollment-race-probe.test.mjs
```

The actual probe must use the existing approved owned-DB execution path, not a
standalone invocation that bypasses its context or postdeploy prerequisites.
Retain the existing runtime and source-matched gate evidence. Record actual
parsed sessions, all7 permutations, all7 observed waits/completions, all7 verify
results and original exits. A parsing source check is not race runtime evidence.
The current race and final required release checks remain pending; deployment
is not authorized by this handoff. Exact hashes and result provenance are in
`registration-operator-observation-race-scanner-evidence.json`.

## Historical Mac handoff: both fixture authentication corrections

The final candidate combines the SQL-fixture correction from
`c1681c7951c3ea092751da640b0545da235a9ef4` with the race-fixture correction on the
same branch. Retrieve the exact final commit supplied in the handoff; verify its
49-path input manifest before executing it.

The last Mac run of `bde58ada982b4c1e01cb352598136d18ed83a35d` passed Node22 53/53,
the layout verifier and Linux fixture10. Guarded-save SQL stopped after 20
subtests at the historical enrollment INSERT (old line264):
`registration_access_denied`, SQL file exit3 / gate exit1. Postdeploy and race7
were not reached. Receipt SHA256:
`00fa1fe299134ccc8bbb350d5d8a7c756dd793c6ae7027844768089e8d6ec90e`.

That INSERT invokes the final `sync_registration_enrollment_lesson_session_v1`
trigger, which requires a live JWT actor even for postgres seed writes. Both
fixtures previously configured JWT only after their enrollment seed INSERTs.
This is a confirmed fixture setup defect; that failure does not establish a
product save defect. Production functions, constraints, RLS, roles and the
isolated DB runner remain unchanged by these two fixture corrections.

The SQL fixture clears all three JWT settings, creates synthetic accounts, then
binds and verifies the active manager before domain seeding. Missing-account,
missing-actor and forged-teacher seed attempts assert exact42501 errors and
absence of rows. Its complete seed includes legacy session identity/time/resource
data, three nonoverlapping schedules, and a normalized lesson linked to its
weekly slot. It releases temporary schedule-write context after seeding and
checks deferred seed constraints in a savepoint that restores their original
timing. Role-revocation recovery uses a distinct active synthetic admin. Final
deferred checks precede history/no-send assertions, JWT cleanup and rollback.

The race fixture now uses the same live-actor prerequisite for global setup.
Its single legacy class has explicit session identity, time and synthetic
teacher/room resources. Setup commits only after deferred seed checks. A/B clear
inherited JWT settings, verify the active actor, enter `authenticated`, and
assert their current role and claims. Their transaction teardown rolls back,
resets role and clears claims. The verification session explicitly remains
postgres so it can inspect private receipts and archived rows. Global teardown
uses the active manager to delete only its scoped business rows and resources,
flushes deferred checks, clears JWT before deleting fixture accounts, asserts
zero scoped leftovers, then drops the fixture schema and commits.

PostgreSQL17 isolationtester runs session teardowns before global teardown; this
allows session cleanup to use the fixture helper before the schema is dropped.
This ordering was checked against the
[official PostgreSQL17 source](https://raw.githubusercontent.com/postgres/postgres/REL_17_STABLE/src/test/isolation/isolationtester.c).

All seven permutation lines, 24 non-entry steps, `capture` and `assert_case` are
byte-identical to c1681c79. The portable probe changes only its embedded spec and
SHA256 literal. Wait/completion counts, SQL/teardown error rejection, exact
permutation order, verification output requirements and all timeouts are
unchanged. Cancellation/archive contenders still exercise fixture lock
boundaries, not those UI flows.

Cloud Node24.19.0 passed 15 focused source/parser tests (SQL6 + race9), with no
failures or skips. This includes the existing six probe tests plus three new
setup/session/teardown boundary tests. These checks use source assertions and
synthetic parser frames; they do not certify SQL execution or concurrent results.
The SQL-only c1681c79 report is historical:
`registration-operator-observation-fixture-auth-evidence.json`. Its then-open race
finding is addressed by the current source and recorded in
`registration-operator-observation-race-fixture-evidence.json`.

Reuse prior evidence only for unchanged inputs: Node466, selected1, SQL6,
Node22 correction checks and Linux10. On the existing Node22 runtime, run the two
changed fixture contract files, then the focused owned-DB gate below. Keep all
existing gate flags and run the race through the postdeploy-gated probe path:

```bash
node --test --test-reporter=tap \
  tests/registration-enrollment-guarded-save.test.mjs \
  tests/registration-enrollment-race-probe.test.mjs
node scripts/run-isolated-supabase-db-tests.mjs \
  --review-head --lint --execute --authorized \
  --request-id registration-guard-final-fixtures-20261015 \
  --postdeploy-contract --transactional-preflight --verify-local-ledger \
  --test supabase/tests/registration_enrollment_guarded_save_test.sql \
  --probe tests/probe-registration-enrollment-guarded-save-concurrency.mjs
```

Use the existing verified `TASK_SUPABASE_CLI`, cached owned runtime and verified
isolationtester wrapper described below; rebind its exact HEAD/source pins and
new owned DB context. Retain baseline parity/smoke, credential-prefix, migration
preparation, both transactional checks, local ledger, lint and cleanup. Record
the actual TAP total, seven completed permutations with seven real lock waits,
all seven verification results and original exit statuses. Postdeploy failure
must stop the probe. Preserve only the structured diagnostic booleans described
below. Current SQL/race execution and exact-source independent review remain
pending; do not label prior or synthetic evidence as a current runtime pass.

## Correction after the first Mac run

The previous tested commit was `bd6fb3ade58f2f9b24ff2bb494bd62024508f9da`.
The Mac receipt SHA256 is
`7a1aac7e1effe5897fec158489967b5bf1f5594b896b293bc18472bd70acb243`:
Node22 passed 488 tests plus one selected case; the existing Linux fixture gate
passed 10/10 with no skips. Six business SQL files passed. The guarded-save SQL
stopped after 20 subtests at its fixture INSERT, with 173 assertions reported
across the seven files and overall exit 1. Race7 was NOT_RUN: the postdeploy gate
failed before any isolationtester version call, session or permutation.

The correction changes test/verification code only:

- Case16 sets `migration_review_required=true`; its legacy pipeline must be
  `migration_review` to satisfy `ops_registration_subject_tracks_check1`.
  The fixture now satisfies that existing constraint. A runtime assertion checks
  that saving its draft retains both review state and the unchanged workflow.
- The old postdeploy workflow predicate rejected every
  `registration_observation_*` match, including the candidate's required booking
  guard and read-only booking lookup. The contract now explicitly requires that
  guard, its ownership/session conditions and paired return status, while
  rejecting observation/appointment writes and retired workflow calls. The exact
  SQL hash pin and mutation regression cases follow the corrected contract.
- A failed postdeploy gate now records the original exit code, output byte counts
  and `false`/`empty`/`unexpected` classification. It then runs a read-only
  diagnostic projection of the same snapshotted predicates in the same owned
  database. This records only 50 condition booleans and 77 function booleans.
  It cannot turn a failed original gate into a pass or start the race probe.

The old raw postdeploy stdout was not retained, so its exact output and any
additional failing predicates remain unknown. The stale predicate is a confirmed
source incompatibility, not proof that it was the only runtime failure. Use the
next narrow run below to obtain that evidence.

No migration SQL, production constraint, application code, race probe/spec,
candidate/final status, fixture image, or authorization rule changes here.
Reuse previous successes only for unchanged inputs; the updated runner and
postdeploy contract require the focused regressions below. The independent exact
source review and final release gates remain outstanding.

The original 42-path candidate digest was
`80a91c8b863ad1dc091487e0e1c909e05b48cb292010f2206d6eaaaf86a10a17` on
`fe872141dc0904660bd7398d6e15d6c9e2788796`. That historical candidate remains
preserved. The current source hashes are in
`registration-operator-observation-inputs.json`; its digest is a different
identity because the base and integration changed.

The integration preserves all 172 main migration entries and adds the one
registration candidate entry in order. It retains the current main receipt
decoder, bounded cache, timetable/close pins and regression tests. The registration
SQL remains byte-identical:

```text
supabase/migrations/20261013084134_registration_enrollment_guarded_save.sql
SHA256 befb880ae63b997aa71912b1775cf779933758b89c00fcb9440b3698fb9338c3
status candidate
```

The feature remains the existing operator-role catalog fallback, observation
application status/input preservation, retired confirmation UI removal with
history preservation, and atomic guarded enrollment save. It does not add
name-based privileges or modify real student records.

## Transfer scope

Use the existing repository work branch
`codex/registration-operator-observation-recovery-20261014`, and check out the
exact commit supplied in the handoff into the already approved separate Mac QA
folder. Do not use the old archive, local paths, raw logs or patches as transfer
payloads. No environment files, credentials, operational dump or original
personal-data fixture is included in the new commit payload.

Fixture person literals were replaced with synthetic labels. Two browser verifier
scripts and their contract test follow those labels; a held phone literal in the
browser verifier now uses the existing synthetic parent family. A source-contract
test checks counselor group labels and nonempty assignments without copying
operational counselor-name literals. Product counselor configuration is unchanged.
This is a bounded claim about the new file contents, not existing repository
history or previous logs.

## Existing runtime only

Use the existing Node22.18.0, Supabase CLI2.115.0, Docker and PostgreSQL17
`isolationtester`. Reuse cached official PostgreSQL17.6.1.159 and pg_prove3.36
images. Do not install a new environment, pull images, change credentials, or
substitute registries. Report a missing prerequisite or refusal and stop.
The two scripts retain the existing owned internal-network/loopback/no-send
boundaries. No production URL or key is required.

The Mac operator has already verified the actual PostgreSQL17.6 isolationtester
binary at
`/nix/store/axzw4y8zm4i1q6kay5rgkqavn2p1lzll-postgresql-17.6/lib/pgxs/src/test/isolation/isolationtester`,
SHA256 `73d09dca273dca63b074950f561d7a6603fadcee2efce4b9b8c7345d6e1b9148`.
Reuse the existing wrapper SHA256
`e4de4a6667ee075a713fe0e320e5e1511519d18f20e3eda9e0dfc20e97e4245e`.
Bind its existing HEAD/source and nonce/CWD/UID/config checks to the new exact
commit and new owned DB. Preserve original stdout/exits and the same-owner DB
checks. No installation is needed.

The cloud environment restarted and only Node24.19.0 remained. Supplemental
network-denied checks passed: receipt22, affected consumers466, the affected
operations source-contract case1, and final browser contract18. Counts overlap.
These are not Node22 workflow-gate results. No new database test ran in cloud.
Earlier evidence can be reused only when its actual inputs remain identical.

For this correction, Node24 supplemental checks passed: receipt22, runner5,
registration/postdeploy contracts20, and focused layout6 (including nine new
predicate-removal cases), total53 with zero failures/skips. The layout verifier
also passed. A broader all-predicate mutation sweep was interrupted and is not
passing evidence; the unchanged full test remains in the default suite. The new
observation checks are separately selectable without removing them from that
suite. Source pins, non-sensitive result counts and log hashes are recorded in
`registration-operator-observation-correction-evidence.json`. These source and
injected-process checks do not prove PostgreSQL or production success.

## Historical validation instructions for bde58ada

These commands preserve the earlier handoff. Use the current race-only handoff
at the top; broader runtime/release gates remain pending.

From the exact checked-out commit, first verify the version and input hashes:

```bash
node --version
python3 - <<'PY'
from pathlib import Path
import hashlib,json
r=Path.cwd()
m=json.loads((r/'docs/qa/registration-operator-observation-inputs.json').read_text())
for row in m['source']:
    p=r/row['path']
    assert p.exists()==row['exists'],row['path']
    assert (hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None)==row['sha256'],row['path']
payload=json.dumps({'baseSha':m['baseSha'],'source':m['source']},ensure_ascii=False,sort_keys=True,separators=(',',':'))
assert hashlib.sha256(payload.encode()).hexdigest()==m['sourceSha256']
print('candidate input hashes match')
PY
```

Run these affected checks on the existing Node22 runtime. The previous unchanged
identity/browser consumers and Linux fixture10 do not need repetition:

```bash
node --test --test-reporter=tap --experimental-strip-types tests/helpers/ai-producer-receipt.test.mjs
node --test --test-reporter=tap \
  --test-name-pattern='postdeploy|isolated DB final gate|isolated DB runner exposes an explicit final-only|isolated DB execute uses sanitized temp config' \
  tests/isolated-supabase-db-tests.test.mjs
node --test --test-reporter=tap \
  tests/registration-enrollment-guarded-save.test.mjs \
  tests/registration-appointment-flat-runtime-finalization.test.mjs \
  tests/supabase-postdeploy-contract.test.mjs
node --test --test-reporter=tap \
  --test-name-pattern='^(?!layout verifier pins every semantic predicate).*postdeploy|read-only execution guard|catalog literal changes' \
  tests/supabase-migration-layout.test.mjs
node scripts/verify-supabase-migration-layout.mjs
```

Use the existing verified local CLI path as `TASK_SUPABASE_CLI`. Run the corrected
guarded-save SQL, mandatory runner prechecks, postdeploy gate, then seven real
cross-session race permutations. The six unchanged passing business files can
reuse the previous receipt; their migrations and execution inputs are unchanged
through the SQL-test stage. Do not repeat the full SQL suite:

```bash
node scripts/run-isolated-supabase-db-tests.mjs \
  --review-head --lint --execute --authorized \
  --request-id registration-mac-guard-correction-20261015 \
  --postdeploy-contract --transactional-preflight --verify-local-ledger \
  --test supabase/tests/registration_enrollment_guarded_save_test.sql \
  --probe tests/probe-registration-enrollment-guarded-save-concurrency.mjs
```

The existing runner also requires baseline parity/smoke, committed credential
prefix, two transactional preflight/rollback checks, migrated schema, local
ledger, DB lint and owned-resource cleanup. The guarded test uses `no_plan()`:
record actual TAP totals instead of copying historical assertion counts. Race
success requires seven completed verification steps, seven observed lock waits,
seven permutations and zero SQL/teardown errors.

If postdeploy fails, preserve only these new structured events:
`isolated_supabase_db_postdeploy_contract_failed` and
`isolated_supabase_db_postdeploy_diagnostics` (or `_diagnostics_unavailable`).
The diagnostic event binds `contractSha256`; each `condition_NN_line_L` maps to
line L of that exact SQL file, and each function key maps to `expected_functions`.
Report every false boolean. Do not copy raw function definitions, connection
strings, private rows or arbitrary stdout/stderr. A failure still stops before
probe execution and cleans up; do not run the probe separately to bypass it.

The separate cached PostgreSQL fixture gate is nine catalog/runtime cases plus
one transactional case. Reuse already passing evidence only for identical actual
inputs. Otherwise run once through the **existing Linux execution path**:

```bash
node scripts/run-isolated-postgres-fixture-tests.mjs
```

This original runner requires `process.platform === 'linux'` and10/10 with zero
skips. Native macOS rejection/skip is not a pass. Do not create a new Linux
environment or spoof the platform to satisfy it.

## Release boundary

The migration remains candidate. Focused runtime results do not satisfy the
strict `--require-final`/full producer receipt and consumer-parity release gate.
Do not promote status merely to run it. Exact-source independent review,
immutable committed base/head history, original Squawk selection and final
receipt/parity remain release obligations after the focused results are reviewed.
Do not repeat unchanged whole DB/static suites as a substitute for input-aware
evidence. No PR merge, operational SQL, deployment or actual student mutation is
authorized by this handoff. Coordinate the next release step with the parent.
