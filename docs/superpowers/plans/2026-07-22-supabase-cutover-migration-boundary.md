# Supabase Cutover Migration Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 일반 Supabase 마이그레이션 배포와 미승인 알림 cutover 원본을 분리해 DB CI를 정상화하면서 provider-zero와 운영 승인 경계를 유지한다.

**Architecture:** `supabase/migrations`만 실행 가능한 active lane으로 유지하고, 알림 원본 6개와 종속 pgTAP 3개는 SHA-256으로 잠긴 immutable quarantine에 둔다. Node 검증기와 GitHub Actions가 active/quarantine 경계와 직접 실행 금지를 fail-closed로 검사하며, 미래 cutover는 과학-aware 최신 정의를 사용하는 새 forward migration과 별도 activation으로 재설계한다.

**Tech Stack:** Supabase CLI 2.107.0, PostgreSQL SQL migrations, Node.js ESM, Node test runner, GitHub Actions, Next.js, Vercel

## Global Constraints

- quarantine 경계 작업은 운영 DB를 변경하지 않는다. 후속 독립 보안 보정은 `20260722130000_notification_prepare_acl_hardening.sql` 한 건으로 정확한 함수 owner/ACL과 migration history만 의도적으로 변경하고 data·함수 본문·runtime 상태는 바꾸지 않는다.
- 설정 UI 외 notification runtime flag 11개는 모두 `false`로 유지한다.
- Google Chat, Web Push, SOLAPI, shadow, worker, watchdog, canonical dispatch를 활성화하지 않는다.
- 원본 6개 SQL의 이름, 순서, 바이트와 SHA-256을 변경하지 않는다.
- 원본 6개를 `apply_migration`, `execute_sql`, `psql`, 임시 copy/move workflow로 실행하지 않는다.
- 같은 timestamp의 no-op 또는 빈 placeholder를 active lane에 만들지 않는다.
- `supabase db push --linked --include-all`은 정상 migration 배포를 위해 유지한다.
- 미래 cutover는 `20260722120000_science_notification_connection.sql`의 과학-aware 함수 정의를 최종 상태로 보존해야 한다.
- 미래 cutover는 `prepare_notification_immediate_delivery_v1`의 postgres owner와 service-role-only EXECUTE ACL도 보존해야 한다.
- 운영 DB에서 `db reset --linked`를 실행하지 않는다.

---

## File Structure

- `supabase/pending-migrations/notification-cutover/manifest.json`: 원본 SQL 순서·SHA-256, 직접 적용 금지 정책, 과학 함수 supersession 계약.
- `supabase/pending-migrations/notification-cutover/README.md`: quarantine이 실행 lane이 아님을 설명하는 한국어 운영 경계.
- `supabase/pending-migrations/notification-cutover/*.sql`: active lane에서 바이트 변경 없이 이동한 원본 6개.
- `supabase/pending-migrations/notification-cutover/tests/*.sql`: pending 객체를 요구하는 pgTAP 3개.
- `scripts/verify-supabase-migration-layout.mjs`: manifest, 파일 타입, 집합, hash, active lane, 전체 workflow를 검증하는 Node CLI.
- `tests/supabase-migration-layout.test.mjs`: 독립 고정 hash와 tamper fixture를 사용하는 경계 회귀 테스트.
- `supabase/migrations/20260722130000_notification_prepare_acl_hardening.sql`: 과학-aware 함수 본문을 바꾸지 않고 누락된 prepare ACL만 보정하는 고정 active migration.
- `.github/workflows/supabase-db-push.yml`: DB 연결 전에 layout verifier를 실행.
- `tests/notification-*.test.mjs`: 원본 SQL source contract를 quarantine 경로에서 계속 읽음.
- `docs/operations/notification-workflow-cutover.md`: 과거 직접 적용 절차를 금지하고 미래 forward 재설계 조건을 명시.
- `docs/operations/supabase-migration-history-repair-2026-07-22.md`: 이번 quarantine과 정상 DB CI 복구 결과를 연결.
- `docs/operations/evidence/*.md`: 역사적 미적용 기록에 현재 quarantine 상태를 덧붙임.

### Task 1: Migration layout RED contract

**Files:**
- Create: `tests/supabase-migration-layout.test.mjs`

**Interfaces:**
- Consumes: `validateSupabaseMigrationLayout({ repoRoot: string }): Promise<string[]>`.
- Produces: 고정 SQL 이름·순서·SHA-256과 layout/workflow tamper 회귀 계약.

- [ ] **Step 1: Write the failing layout test**

테스트에 다음 고정값을 직접 둔다.

```js
const EXPECTED_SQL = Object.freeze([
  ["20260716195000_notification_workflow_legacy_closure.sql", "e9131131f0d9419a4a8fdf5d69a58a1047a41583f98d9ef7b5b376374ee52975"],
  ["20260716195500_notification_worker_schedule.sql", "f9f335e00bb3bba815019dcf5ce73905c8de883db90ec7c99d35ae99d2609696"],
  ["20260716195800_notification_registration_provider_claim.sql", "c682f44b0c851e49b7cec14e703ee7504bdd19b8be2416a49fc8112058826877"],
  ["20260716195900_notification_control_plane_forward_compat.sql", "054914802ac9d0d9475fd18f2b52deb7bfd27552a3b92b7b5331c6d35003ee11"],
  ["20260716196000_notification_shadow_fixture_runner.sql", "ef3ebb3a345bc734343526655fd614f51a8415dbc3a87ce1a60e8e76aa91ebd1"],
  ["20260717145304_notification_shadow_deterministic_evidence.sql", "610c1ce889aa5d7deb29a5d48186976a400774a75e347f600386068af1744833"],
])
```

다음 case를 작성한다.

```js
test("cutover SQL은 active lane 밖의 immutable quarantine에만 존재한다", async () => {
  const errors = await validateSupabaseMigrationLayout({ repoRoot })
  assert.deepEqual(errors, [])
  for (const [file, digest] of EXPECTED_SQL) {
    assert.equal(await sha256(join(quarantineDir, file)), digest)
    await assert.rejects(readFile(join(activeDir, file)))
  }
})
```

두 번째 테스트는 정상 저장소를 `mkdtemp` 아래로 복사한 독립 fixture 네 개를 사용한다. 첫 fixture는 195000 끝에 개행을 추가하고 `cutover_sql_hash_mismatch`를, 두 번째는 quarantine에 symlink를 추가하고 `quarantine_entry_not_regular`을, 세 번째는 195000을 active lane에도 복사하고 `cutover_sql_present_in_active_lane`을, 네 번째는 DB workflow의 verifier 줄을 삭제하고 `db_push_without_prior_layout_verifier`를 각각 정확히 포함하는지 검사한다. 모든 fixture는 `after` hook에서 제거한다.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test tests/supabase-migration-layout.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/verify-supabase-migration-layout.mjs` or missing quarantine manifest.

### Task 2: Immutable quarantine and fail-closed verifier

**Files:**
- Create: `supabase/pending-migrations/notification-cutover/manifest.json`
- Create: `supabase/pending-migrations/notification-cutover/README.md`
- Move: six named SQL files from `supabase/migrations/`
- Move: `supabase/tests/notification_workflow_seed_test.sql`
- Move: `supabase/tests/notification_worker_schedule_test.sql`
- Move: `supabase/tests/notification_shadow_deterministic_evidence_test.sql`
- Create: `scripts/verify-supabase-migration-layout.mjs`
- Modify: `.github/workflows/supabase-db-push.yml`
- Test: `tests/supabase-migration-layout.test.mjs`

**Interfaces:**
- Consumes: repository root and checked-in manifest.
- Produces: `validateSupabaseMigrationLayout({ repoRoot }): Promise<string[]>` and a zero/nonzero CLI exit contract.

- [ ] **Step 1: Move exact source artifacts**

Use `git mv` so Git records path-only changes. Recompute all six SHA-256 values and require the values to match Task 1 before creating the manifest.

- [ ] **Step 2: Add the ordered manifest**

```json
{
  "schemaVersion": 1,
  "lane": "notification-cutover",
  "status": "quarantined",
  "executionPolicy": "forbidden_to_apply_directly",
  "replacementPolicy": "forward_dated_install_and_separate_activation",
  "sqlFiles": [
    { "file": "20260716195000_notification_workflow_legacy_closure.sql", "sha256": "e9131131f0d9419a4a8fdf5d69a58a1047a41583f98d9ef7b5b376374ee52975" },
    { "file": "20260716195500_notification_worker_schedule.sql", "sha256": "f9f335e00bb3bba815019dcf5ce73905c8de883db90ec7c99d35ae99d2609696" },
    { "file": "20260716195800_notification_registration_provider_claim.sql", "sha256": "c682f44b0c851e49b7cec14e703ee7504bdd19b8be2416a49fc8112058826877" },
    { "file": "20260716195900_notification_control_plane_forward_compat.sql", "sha256": "054914802ac9d0d9475fd18f2b52deb7bfd27552a3b92b7b5331c6d35003ee11" },
    { "file": "20260716196000_notification_shadow_fixture_runner.sql", "sha256": "ef3ebb3a345bc734343526655fd614f51a8415dbc3a87ce1a60e8e76aa91ebd1" },
    { "file": "20260717145304_notification_shadow_deterministic_evidence.sql", "sha256": "610c1ce889aa5d7deb29a5d48186976a400774a75e347f600386068af1744833" }
  ],
  "pgTapTests": [
    "notification_workflow_seed_test.sql",
    "notification_worker_schedule_test.sql",
    "notification_shadow_deterministic_evidence_test.sql"
  ],
  "supersededDefinitions": [
    { "function": "public.revalidate_immediate_notification_delivery_v1", "supersededBy": "20260722120000_science_notification_connection.sql" },
    { "function": "public.prepare_notification_immediate_delivery_v1", "supersededBy": "20260722120000_science_notification_connection.sql" }
  ]
}
```

- [ ] **Step 3: Implement the verifier**

Create the exported interface exactly as follows.

```js
export async function validateSupabaseMigrationLayout({ repoRoot = defaultRepoRoot } = {}) {
  const errors = []
  return errors
}
```

The implementation uses module constants identical to Task 1 and performs these exact checks in order: manifest JSON parse and exact policy fields; exact ordered SQL/hash entries; exact pgTAP list; exact two superseded definitions; `lstat` regular-directory/regular-file checks; exact quarantine top-level set of `README.md`, `manifest.json`, `tests`, and six SQL files; exact tests set of three pgTAP files; SHA-256 and drain-marker cardinality; active filename absence and active SQL drain-marker absence; all workflow `.yml`/`.yaml` files free of quarantine paths and six filenames; and every `supabase db push` line equal to `supabase db push --linked --include-all` with an earlier `node scripts/verify-supabase-migration-layout.mjs`. Each failure appends its stable snake-case error code plus the affected path. Workflow files containing `--workdir`, or shell commands beginning with `cp`, `mv`, or `rsync`, fail with `db_push_workflow_layout_bypass`.

The direct CLI prints one Korean error per line and sets `process.exitCode = 1`; success prints `Supabase migration layout verified.`.

- [ ] **Step 4: Wire the verifier before secrets and DB access**

```yaml
      - name: Verify Supabase migration layout
        run: node scripts/verify-supabase-migration-layout.mjs
```

Keep the push command exactly:

```yaml
      - name: Push migrations
        run: supabase db push --linked --include-all
```

- [ ] **Step 5: Run the focused tests and verifier**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test tests/supabase-migration-layout.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  scripts/verify-supabase-migration-layout.mjs
```

Expected: all tests PASS and verifier exits 0.

### Task 3: Source contracts and operations documentation

**Files:**
- Modify: `tests/notification-approval-adapter.test.mjs`
- Modify: `tests/notification-provider-endpoint-closure.test.mjs`
- Modify: `tests/notification-registration-handoffs.test.mjs`
- Modify: `tests/notification-control-plane-worker.test.mjs`
- Modify: `tests/notification-operations.test.mjs`
- Modify: `tests/notification-workflow-cutover.test.mjs`
- Modify: `tests/notification-shadow-fixture-runner.test.mjs`
- Modify: `tests/notification-shadow-deterministic-evidence.test.mjs`
- Modify: `docs/operations/notification-workflow-cutover.md`
- Modify: `docs/operations/supabase-migration-history-repair-2026-07-22.md`
- Modify: `docs/operations/evidence/2026-07-18-notification-silent-end-to-end-verification.md`
- Modify: `docs/operations/evidence/2026-07-19-notification-bridge-observation-start.md`

**Interfaces:**
- Consumes: quarantine paths and manifest policy from Task 2.
- Produces: unchanged SQL source-contract coverage and a non-executable future cutover runbook.

- [ ] **Step 1: Update direct test URLs only**

Replace each direct `../supabase/migrations/<cutover-file>` URL with `../supabase/pending-migrations/notification-cutover/<cutover-file>`. Update the deterministic migration directory scan to the quarantine directory. Update the workflow-seed pgTAP URL to `../supabase/pending-migrations/notification-cutover/tests/notification_workflow_seed_test.sql`.

- [ ] **Step 2: Replace obsolete direct-apply instructions**

The runbook must say:

```text
quarantine의 과거 6개 SQL은 reference-only이며 직접 적용하거나 active lane으로 승격하지 않는다.
관찰을 다시 시작해도 먼저 최신 schema 기준의 새 forward-dated install migration과
service-role 전용 activation RPC를 별도 설계·검증·승인한다.
```

Explicitly name the two science-aware functions that old SQL would overwrite and retain the 24-hour/complete-Seoul-day and seven-day-shadow operational gates as historical requirements.

- [ ] **Step 3: Run direct-reference and notification regressions**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test --experimental-strip-types \
  tests/supabase-migration-layout.test.mjs \
  tests/notification-approval-adapter.test.mjs \
  tests/notification-provider-endpoint-closure.test.mjs \
  tests/notification-registration-handoffs.test.mjs \
  tests/notification-control-plane-worker.test.mjs \
  tests/notification-operations.test.mjs \
  tests/notification-workflow-cutover.test.mjs \
  tests/notification-shadow-fixture-runner.test.mjs \
  tests/notification-shadow-deterministic-evidence.test.mjs
```

Expected: PASS with no provider calls or remote DB mutations.

### Task 4: Full verification and production release

**Files:**
- Verify all files listed above.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: synchronized active migration history, one intentional prepare ACL/history delta, unchanged data/runtime/provider-zero state, green DB CI, READY Vercel deployment.

- [ ] **Step 1: Run repository verification**

Run the full Node test suite, `pnpm exec tsc --noEmit`, `pnpm lint`, `next build --webpack`, the migration layout verifier and `git diff --check` using the bundled Node/pnpm runtime.

Expected: all exit 0; existing large-file Babel notices may remain informational.

- [ ] **Step 2: Verify active migration dry-run and remote invariants**

Run the linked Supabase migration list and `supabase db push --linked --include-all --dry-run` from the clean release checkout.

Expected: dry-run은 아직 적용되지 않은 `20260722130000` 한 건만 제시하거나, 적용 뒤에는 remote-only/active local-only 버전 없이 `Linked project is up to date.`를 반환한다. 함수 본문 지문, 데이터, 12개 runtime flag, 과학 Google Chat connection과 `pg_cron`은 pre-change snapshot과 같아야 하며 ACL만 기대 행렬로 달라야 한다.

- [ ] **Step 3: Independent review**

Review for accidental executable references, SQL byte drift, manifest/test disagreement, workflow bypass, provider activation and science function regression. Fix every Critical or Important finding and rerun focused verification.

- [ ] **Step 4: Commit and push official main**

Stage only the explicit quarantine, verifier, workflow, test, documentation, spec and plan files. Commit, push `main`, and wait for the Supabase DB workflow and Vercel production deployment.

Expected: DB workflow succeeds with `Linked project is up to date.` and Vercel reports READY for the same commit.

- [ ] **Step 5: Verify production and post-deploy safety**

Verify `/` and `/admin/registration` return HTTP 200. Re-query migration history, schema fingerprint, runtime flags, science connection and pg_cron after deployment.

Expected: application routes healthy; migration history에는 `20260722130000` 한 건만 추가되고 정확한 prepare ACL만 달라진다. 함수 본문·data·runtime flags·provider-zero 상태는 unchanged이고 normal CI가 green이다.
