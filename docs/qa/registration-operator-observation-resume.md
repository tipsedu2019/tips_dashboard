# Registration operator and observation candidate

This is the single integration of the preserved registration candidate with main
`1c2159d6924596072ab7fda76fbf24458e384b4b` (PR144, including PR143). It is ready
for the existing Mac operator to retrieve and validate, not for deployment.

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

The cloud environment restarted and only Node24.19.0 remained. Supplemental
network-denied checks passed: receipt22, affected consumers466, the affected
operations source-contract case1, and final browser contract18. Counts overlap.
These are not Node22 workflow-gate results. No new database test ran in cloud.
Earlier evidence can be reused only when its actual inputs remain identical.

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
print('candidate input hashes match')
PY
```

Run the changed receipt and identity-consumer checks on the existing Node22
runtime; no full repository or full database suite is requested here:

```bash
node --test --test-reporter=tap --test-concurrency=1 --experimental-strip-types \
  tests/helpers/ai-producer-receipt.test.mjs \
  tests/registration-track-fixtures.test.mjs \
  tests/registration-track-service.test.mjs \
  tests/registration-track-workspace.test.mjs \
  tests/registration-application-model.test.mjs \
  tests/registration-observation-workspace.test.mjs \
  tests/registration-browser-verifier-contract.test.mjs
node --test --test-reporter=tap --experimental-strip-types \
  --test-name-pattern='^transfer workspace inherits withdrawal layout while preserving transfer fields$' \
  tests/ops-task-workspace.test.mjs
```

Use the existing verified local CLI path as `TASK_SUPABASE_CLI`. A single isolated
registration run covers seven business SQL files and seven real cross-session
race permutations:

```bash
node scripts/run-isolated-supabase-db-tests.mjs \
  --review-head --lint --execute --authorized \
  --request-id registration-mac-operator-observation-20261014 \
  --postdeploy-contract --transactional-preflight --verify-local-ledger \
  --test supabase/tests/registration_enrollment_guarded_save_test.sql \
  --test supabase/tests/registration_manager_write_and_integrity_fence_test.sql \
  --test supabase/tests/registration_collaboration_write_role_test.sql \
  --test supabase/tests/registration_observation_booking_test.sql \
  --test supabase/tests/registration_observation_status_independence_test.sql \
  --test supabase/tests/registration_manual_workflow_status_test.sql \
  --test supabase/tests/active_registration_workflow_sqlstate_contract_test.sql \
  --probe tests/probe-registration-enrollment-guarded-save-concurrency.mjs
```

The existing runner also requires baseline parity/smoke, committed credential
prefix, two transactional preflight/rollback checks, migrated schema, local
ledger, DB lint and owned-resource cleanup. The guarded test uses `no_plan()`:
record actual TAP totals instead of copying historical assertion counts. Race
success requires seven completed verification steps, seven observed lock waits,
seven permutations and zero SQL/teardown errors.

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
