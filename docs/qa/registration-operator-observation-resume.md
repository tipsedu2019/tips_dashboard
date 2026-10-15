# Registration operator and observation candidate

This is the single integration of the preserved registration candidate with main
`1c2159d6924596072ab7fda76fbf24458e384b4b` (PR144, including PR143). It is ready
for the existing Mac operator to retrieve and validate, not for deployment.

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

## Minimal remaining checks

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
