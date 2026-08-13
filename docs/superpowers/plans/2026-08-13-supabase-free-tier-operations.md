# Supabase Free Tier Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supabase Free/Nano에서 Disk I/O 재발을 조기에 발견하고, 새 전체 조회·주기 worker·과도한 audit 성장을 막으며, 삭제 없이도 장기 운영할 수 있는 검증 가능한 운영 경계를 만든다.

**Architecture:** CI의 정적 query/cron guard가 새 부하 패턴을 차단하고, 수동 read-only baseline이 DB size/query/scan/RLS/cron을 동일 SQL로 비교한다. 신규 audit UPDATE는 full-row 두 벌 대신 reversible field diff와 hash를 저장한다. 180일 초과 audit는 검증된 외부 archive가 있을 때만 별도 승인으로 삭제하며, 기존 notification control plane은 신규 경로의 실제 수신과 zero-writer 증거 뒤에만 폐기한다.

**Tech Stack:** PostgreSQL 17, Supabase CLI/PostgREST, Node test runner, pgTAP, GitHub Actions, existing Next.js/TypeScript repository.

## Global Constraints

- 승인 기준은 `docs/superpowers/specs/2026-08-13-supabase-free-tier-dashboard-notification-optimization-design.md`다.
- 구현 기준은 실행 시점 최신 `origin/main`이다. 계획 작성 기준에는 `20260808172743_rls_policy_initplan_consolidation.sql`, `20260808172835_ops_registration_read_policy_optimization.sql`, `docs/runbooks/supabase-resource-pressure.md`가 이미 있으므로 이를 반복하거나 되돌리지 않는다.
- 실행 순서는 홈/통계 계획 -> query-surface 계획 -> lightweight-alert 계획 -> 이 운영 계획이다. 이 계획의 CI wrapper는 앞선 query plan이 만든 `src/lib/query-surface-budget.js`와 `scripts/verify-query-surface-budget.mjs`를 사용하므로 독립 stale branch에서 먼저 구현하지 않는다.
- Supabase compute upgrade, project restart, pause/restore, production migration, data deletion, index drop, cron activation은 source 작업에 포함되지 않는다.
- Advisor의 모든 항목을 일괄 수정하지 않는다. query plan과 role-visible row parity가 증명된 항목만 한 migration에 작은 묶음으로 처리한다.
- restart 직후 `unused_index`는 삭제 근거가 아니다. 최소 7일 정상 운영 통계를 수집하기 전 unused index를 drop하지 않는다.
- `dashboard_audit_logs` 기존 행은 수정·backfill·삭제하지 않는다. 새 audit format은 forward-only다.
- audit UPDATE diff는 되돌릴 수 있어야 한다. INSERT는 after full snapshot, DELETE는 before full snapshot을 계속 보존한다.
- audit hash는 trigger가 본 canonical full row 전체를 대상으로 하고 patch는 그 hash 대상에서 실제로 달라진 모든 key를 포함한다. `updated_at`만 바뀐 update도 생략하지 않는다.
- audit 180일 초과 삭제는 archive file, row count, month checksum, restore rehearsal이 모두 일치하고 사용자가 destructive phase를 다시 승인한 경우만 가능하다.
- 신규 monitoring cron/heartbeat를 만들지 않는다. resource baseline은 release 전후와 장애 시 수동으로 실행한다.
- 실제 DB 상태, source/test, migration applied, `main`, Vercel, runtime, provider receipt를 각각 별도 증거로 보고한다.
- archive tooling은 이 계획에서 후보 preview까지만 만든다. archive format, encryption, destination, retention owner, export/restore가 승인되기 전에는 verifier나 deletion authorization artifact를 만들지 않는다.
- `dashboard_audit_diff_format` migration은 홈/통계 계획의 `supabase/test-baselines/dashboard-free-tier-v1.manifest.json`에 생성 직후 `draft`/null hash, SQL+RED test 완료 뒤 DB test 직전 current SHA-256의 `candidate`, 모든 pgTAP/probe GREEN 뒤 commit 직전 동일 hash의 `final`로 승격한다. SQL이 바뀌면 candidate hash와 DB evidence를 새로 만든다.

## Fixed Runtime Commands

```bash
export TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
export TASK_PNPM=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm
export TASK_SUPABASE=/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase
export TASK_REQUEST_ID=$(/usr/bin/uuidgen | /usr/bin/tr '[:upper:]' '[:lower:]')
```

각 task를 시작할 때 같은 shell에서 위 네 줄을 실행하고 모든 `Run:` block을 그 shell에서 실행한다. 새 shell이면 네 줄을 모두 다시 실행한다. local DB command는 `--request-id "$TASK_REQUEST_ID"`를 사용한다. bare `node`, `npm`, `npx`를 사용하지 않는다.

## New Files

- `tests/free-tier-operational-guardrails.test.mjs`
- `scripts/verify-free-tier-query-contracts.mjs`
- `scripts/collect-supabase-resource-evidence.mjs`
- `scripts/compare-supabase-resource-evidence.mjs`
- `tests/supabase-resource-evidence-comparator.test.mjs`
- `scripts/preview-dashboard-audit-archive.mjs`
- `scripts/audit-legacy-notification-dependencies.mjs`
- `supabase migration new dashboard_audit_diff_format`가 생성한 exact migration path
- `supabase/tests/dashboard_audit_diff_format_test.sql`
- `tests/dashboard-audit-diff-format.test.mjs`
- `tests/dashboard-audit-chain-concurrency.test.mjs`
- `scripts/probe-dashboard-audit-chain-concurrency.mjs`
- `tests/dashboard-audit-archive-preview.test.mjs`
- `tests/legacy-notification-dependency-audit.test.mjs`
- `docs/operations/evidence/supabase-free-tier-baseline-template.md`
- `docs/operations/free-tier-performance-migration-scopes.json`
- `docs/operations/legacy-notification-object-manifest.json`
- `.github/workflows/free-tier-guardrails.yml`

## Existing Files to Modify

- `docs/runbooks/supabase-resource-pressure.md`
- `package.json`
- `supabase/migrations/20260728230427_continuous_class_schedule_release2_contracts.sql` is reference only and must not be edited.

## Baseline Evidence Contract

Evidence output contains aggregates and query fingerprints only. 모든 PostgreSQL bigint/counter/query ID는 JSON decimal string으로 직렬화한다.

```ts
type EvidenceSection<T> =
  | { available: true; data: T }
  | { available: false; errorCode: string }

export type SupabaseResourceEvidence = {
  schemaVersion: "supabase-resource-evidence-v1"
  collectorVersion: string
  capturedAt: string
  projectRef: string
  postgresVersion: string
  collection: {
    clientStartedAt: string
    clientEndedAt: string
    clientMonotonicDurationMs: string
    databaseBracketStartedAt: string
    databaseBracketEndedAt: string
    bracketComplete: true
  }
  resetMarkers: {
    databaseStatsReset: string | null
    statementsStatsReset: string | null
  }
  extensions: Record<string, { available: boolean; version: string | null }>
  database: EvidenceSection<{ databaseBytes: string }>
  relations: EvidenceSection<Array<{ relation: string; totalBytes: string }>>
  activity: EvidenceSection<{ active: string; waiting: string; idleInTransaction: string }>
  blockers: EvidenceSection<Array<{
    blockedPidHash: string
    blockerPidHash: string
    blockedSeconds: string
    waitEventType: string | null
  }>>
  topStatements: EvidenceSection<Array<{
    queryId: string
    calls: string
    totalMs: string
    meanMs: string
    rows: string
    sharedBlocksRead: string
    normalizedFingerprint: string
  }>>
  cron: EvidenceSection<Array<{ jobId: string; name: string; active: boolean; schedule: string }>>
  scans: EvidenceSection<Array<{
    relation: string
    seqScan: string
    seqTuples: string
    indexScan: string
    deadTuples: string
  }>>
  auditGrowth: EvidenceSection<Array<{
    month: string
    rows: string
    estimatedBytes: string
  }>>
  advisorCounts: EvidenceSection<Record<string, string>>
}
```

SQL/query text, literals, student data, phone, email, secrets, full provider payload를 evidence JSON, stdout, stderr, error object 어디에도 넣지 않는다. section unavailable과 실제 0은 절대 같은 값으로 표현하지 않는다. 두 evidence의 reset marker가 다르면 counter delta는 무효이며 새 observation window를 시작한다.

---

### Task 1: 최신 main과 현재 운영 최적화 baseline 고정

**Files:**
- Verify: existing migrations/runbook/tests
- Create: `docs/operations/evidence/supabase-free-tier-baseline-template.md`

- [ ] **Step 1: 최신 main worktree에서 시작한다**

  `superpowers:using-git-worktrees` 지침에 따라 새 branch/worktree를 만들고, 문서 commits만 옮긴다. 현재 root branch의 application source를 기반으로 구현하지 않는다.

- [ ] **Step 2: 이미 적용된 recurrence-prevention 회귀를 실행한다**

  ```bash
  "$TASK_NODE" --test --experimental-strip-types \
    tests/dashboard-resource-pressure.test.mjs \
    tests/supabase-read-safety.test.mjs \
    tests/supabase-rls-resource-pressure.test.mjs \
    tests/registration-customer-reminder-scheduler.test.mjs
  ```

  Expected: 8월 8~9일의 bounded reads, off cron, RLS consolidation 계약이 PASS. 실패하면 새 운영 변경 전에 baseline drift를 해결한다.

- [ ] **Step 3: evidence template를 만든다**

  source/test, production read-only baseline, migrations, deployment, runtime, provider를 별도 표로 둔다. template에는 값 칸만 있고 secret/raw query를 넣는 칸은 만들지 않는다.

- [ ] **Step 4: 커밋한다**

  Commit: `docs: define free tier evidence boundary`

---

### Task 2: 새 전체 조회와 주기 worker를 막는 CI guard

**Files:**
- Create: `scripts/verify-free-tier-query-contracts.mjs`
- Create: `tests/free-tier-operational-guardrails.test.mjs`
- Modify: `package.json`
- Create: `.github/workflows/free-tier-guardrails.yml`

- [ ] **Step 1: 현재/허용 legacy와 신규 위반을 구분하는 RED 테스트를 작성한다**

  verifier CI mode는 `--base <40-char-sha> --head <40-char-sha> --surface <name|all>`을 필수로 받고 `git diff <merge-base>..<head>`의 새/변경 list loader와 migration만 검사한다. local pre-commit mode는 `--base HEAD --surface <name|all> --worktree`로 committed/index/unstaged changes를 함께 검사한다. base/head가 object가 아니거나 merge-base를 만들 수 없거나 두 mode가 섞이면 fail-closed한다. historical migrations의 기존 cron 문자열을 전역 실패시키지 말고 immutable allowlist hash로만 허용한다.

- [ ] **Step 2: 다음 금지 규칙을 고정한다**

  - list loader의 `select("*")`
  - order/limit 없는 신규 list read
  - GET/RPC의 retry 기본값 사용
  - 신규 `* * * * *` notification cron
  - watchdog/heartbeat table 또는 write 추가
  - `cron.schedule` migration-time 직접 activation
  - full phone/message/webhook/provider raw receipt columns
  - broad cron delete/unschedule pattern

  list query 검사는 query-surface 계획의 `src/lib/query-surface-budget.js`와 thin CLI를 import해 사용한다. operations wrapper는 cron/audit/receipt/PII 규칙만 추가하고 projection/order/limit/retry/large-IN 규칙과 예외 manifest를 중복 구현하지 않는다.

- [ ] **Step 3: approved 예외를 좁게 정의한다**

  schema probing, exact-ID detail, test fixture는 file/symbol 단위 reason과 checksum이 있어야 예외가 된다. 새 예외 추가는 test diff에서 보이게 한다.

- [ ] **Step 4: package/CI에 연결한다**

  ```json
  {
    "scripts": {
      "verify:free-tier": "node scripts/verify-free-tier-query-contracts.mjs"
    }
  }
  ```

  신규 `.github/workflows/free-tier-guardrails.yml`는 `pull_request`의 `opened|synchronize|reopened|ready_for_review`에서 실행한다. exact job은 다음과 같다.

  ```yaml
  permissions:
    contents: read
  jobs:
    free-tier-guardrails:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
          with:
            fetch-depth: 0
        - uses: actions/setup-node@v4
          with:
            node-version: 22.18.0
            cache: npm
        - run: npm ci --ignore-scripts
        - run: node --test --experimental-strip-types tests/query-surface-budget.test.mjs tests/free-tier-operational-guardrails.test.mjs
        - shell: bash
          env:
            BASE_SHA: ${{ github.event.pull_request.base.sha }}
            HEAD_SHA: ${{ github.event.pull_request.head.sha }}
          run: |
            set -euo pipefail
            merge_base="$(git merge-base "$BASE_SHA" "$HEAD_SHA")"
            node scripts/verify-free-tier-query-contracts.mjs --base "$merge_base" --head "$HEAD_SHA" --surface all
  ```

  이 PR workflow에는 Supabase secret과 DB push가 없다. 기존 `.github/workflows/supabase-db-push.yml`은 이 task에서 수정하지 않고 production migration 배포 책임만 유지한다.

- [ ] **Step 5: GREEN과 커밋을 실행한다**

  Run: `"$TASK_NODE" --test --experimental-strip-types tests/free-tier-operational-guardrails.test.mjs tests/query-surface-budget.test.mjs`

  Run: `"$TASK_PNPM" run verify:free-tier -- --base HEAD --surface all --worktree`

  Commit: `test: guard free tier query and cron budgets`

---

### Task 3: 동일 SQL을 사용하는 read-only resource evidence collector

**Files:**
- Create: `scripts/collect-supabase-resource-evidence.mjs`
- Create: `scripts/compare-supabase-resource-evidence.mjs`
- Modify: `docs/runbooks/supabase-resource-pressure.md`
- Create: tests in `tests/free-tier-operational-guardrails.test.mjs`
- Create: `tests/supabase-resource-evidence-comparator.test.mjs`

- [ ] **Step 1: query manifest RED 테스트를 작성한다**

  collector가 exact read-only statement IDs/checksums만 허용하고 `insert|update|delete|alter|drop|vacuum|reindex|restart|cron.schedule`을 거부하는지 검사한다. plan mode와 실패 stderr에도 SQL/query text를 출력하지 않고 manifest ID, SHA-256, parameter count만 보여야 한다. live error는 HTTP status와 fixed error code만 남긴다.

- [ ] **Step 2: 다음 read-only query set을 manifest로 구현한다**

  - `pg_database_size(current_database())`
  - top relations via `pg_total_relation_size`
  - active/wait/idle-in-transaction sessions
  - blockers/blocked durations
  - top `pg_stat_statements` by total time and shared block reads
  - `pg_stat_user_tables` scan/dead tuple/autovacuum counters
  - exact notification cron name/active/schedule
  - `dashboard_audit_logs` monthly count/bytes estimate
  - `pg_stat_database.stats_reset`, `pg_stat_statements_info.stats_reset`
  - `server_version`, `pg_stat_statements|pg_cron|pgcrypto` extension availability/version
  - advisor counts via exact experimental `GET /v1/projects/{ref}/advisors/performance` and `/advisors/security`

  exact section IDs는 `database`, `relations`, `activity_blockers`, `statements`, `scans`, `cron`, `audit_growth`, `extensions_resets`, `advisors` 아홉 개다. DB query는 advisor GET을 제외한 최대 8 sections, section당 최대 20 rows, 전체 직렬화 payload 256KiB로 제한한다. top relations/statements/scans/blockers와 audit months는 반드시 `limit 20`이다. 각 DB section은 `BEGIN TRANSACTION READ ONLY`, `SET LOCAL statement_timeout='4000ms'`, `SET LOCAL lock_timeout='500ms'`, `SET LOCAL application_name='tips_free_tier_evidence_v1'`, query, `COMMIT`의 고정 envelope를 사용한다.
  statement fingerprint는 DB 안에서 `encode(digest(query, 'sha256'), 'hex')`로 만들고 query column 자체는 SELECT/response에 포함하지 않는다.

- [ ] **Step 3: secret-safe executor boundary를 구현한다**

  CLI는 다음 exact contract다.

  ```text
  "$TASK_NODE" scripts/collect-supabase-resource-evidence.mjs
    --mode plan|execute
    --output "$TASK_EVIDENCE_OUTPUT"    # execute에 필수인 absolute path env
    --request-id "$TASK_REQUEST_ID"     # execute에 필수
    --authorized                        # execute에 필수
  env: SUPABASE_DATABASE_READ_TOKEN, SUPABASE_PROJECT_REF
  ```

  plan은 manifest IDs/checksums/budgets만 stdout에 보여 준다. execute는 홈 계획의 reviewed `scripts/fixtures/supabase-management-read-only-query-contract.json`을 exact owner로 재사용하고, fine-grained `database_read` permission/OAuth `database:read` token으로 `Authorization: Bearer`와 JSON `{query,parameters}`를 보내 status 201만 성공으로 받는다. Supabase Management API의 exact read-only endpoint와 advisor GET 두 개만 사용한다. client는 첫 HTTP 전 wall-clock `clientStartedAt`과 monotonic start를 기록하고, dedicated read-only `clock_timestamp()` start request가 성공한 뒤에만 section collection을 시작한다. 모든 sections/advisors가 끝난 뒤 dedicated read-only end request를 실행하고, 그 HTTP response를 받은 다음 `clientEndedAt`과 monotonic duration을 기록한다. 두 DB bracket request 중 하나라도 실패하거나 wall-clock/monotonic order가 모순이면 output을 쓰지 않고 `evidence_bracket_incomplete`로 fail-closed한다. section 내부 timestamp를 전체 collection 경계라고 부르지 않는다. token에는 `database_read`와 선택적으로 `advisors_read`만 요구한다. advisor 권한/experimental endpoint가 없으면 그 section만 `{available:false,errorCode:"advisor_unavailable"}`이고 DB sections를 추론해 채우지 않는다. 401/403/404/405/429/500, redirect, non-201 success, response-shape drift는 fixture의 fixed error로 처리하고 DB evidence output을 쓰지 않는다. DB endpoint drift는 write-capable `/database/query`나 `read_only:true` compatibility endpoint로 fallback하지 않는다. `SUPABASE_DATABASE_READ_TOKEN`과 `SUPABASE_PROJECT_REF`는 environment에서만 읽고 DB URL/password/access token을 argv, output, evidence file에 넣지 않는다.

  output은 기존 파일이 있으면 거부한다. same-directory temp를 `O_CREAT|O_EXCL`, mode `0600`으로 만들고 JSON flush/fsync 후 target이 여전히 없을 때 atomic rename한다. 실패 시 exact temp만 제거하고 target을 overwrite하지 않는다.

- [ ] **Step 4: runbook에 비교 규칙을 추가한다**

  comparator는 env `TASK_EVIDENCE_BEFORE`, `TASK_EVIDENCE_AFTER`, `TASK_EVIDENCE_COMPARISON_OUTPUT`의 absolute paths를 받아 `"$TASK_NODE" scripts/compare-supabase-resource-evidence.mjs --before "$TASK_EVIDENCE_BEFORE" --after "$TASK_EVIDENCE_AFTER" --output "$TASK_EVIDENCE_COMPARISON_OUTPUT"`로 실행한다. 각 capture의 conservative interval을 `[clientStartedAt,clientEndedAt]`로 사용하고 DB bracket timestamps가 그 interval과 합리적인 clock skew 안에 들어오는지 검증한다. before의 client end부터 after의 client start까지를 counter observation interval로 보고, bracket incomplete/overlap/order drift는 `unknown`이다. source release마다 baseline capture는 deployment 시작 전 10분 이내, after capture는 deployment completed 뒤 30±5분에 수집하고 다음 업무 피크는 별도 KST 60분 시작/끝 capture 쌍으로 비교한다. projectRef/postgres version/database+statements reset markers/extension availability가 같을 때만 counter delta를 계산한다. 다르면 delta는 `unknown`이고 새 pair를 수집한다. comparator output도 exclusive mode 0600/atomic write다. restart 직후 누적 counter 하나로 index를 제거하지 않는다는 경고를 둔다.

- [ ] **Step 5: tests와 커밋을 실행한다**

  Run: `"$TASK_NODE" --test --experimental-strip-types tests/free-tier-operational-guardrails.test.mjs tests/supabase-resource-evidence-comparator.test.mjs`

  comparator RED/GREEN은 malformed decimal string, missing bracket, client/DB time inversion, reset marker change, extension drift, exclusive-output collision, mode 0600 atomic rename을 각각 검증한다.

  Run: `"$TASK_NODE" scripts/collect-supabase-resource-evidence.mjs --mode plan`

  Commit: `ops: add read only Supabase resource evidence`

---

### Task 4: 신규 audit UPDATE를 reversible diff로 전환

**Files:**
- Create via CLI: generated `dashboard_audit_diff_format` migration
- Create: `supabase/tests/dashboard_audit_diff_format_test.sql`
- Create: `tests/dashboard-audit-diff-format.test.mjs`
- Create: `tests/dashboard-audit-chain-concurrency.test.mjs`
- Create: `scripts/probe-dashboard-audit-chain-concurrency.mjs`
- Replace by forward migration only: `public.log_dashboard_audit_event()` with `dashboard_private.log_dashboard_audit_event_v2()`

- [ ] **Step 1: format/restore RED 테스트를 작성한다**

  먼저 `"$TASK_SUPABASE" migration new dashboard_audit_diff_format`를 실행하고 exact path를 공용 manifest에 `draft`/null hash로 기록한다. SQL+RED test 뒤 DB test 직전에 current SHA-256의 `candidate`, pgTAP+concurrency probe GREEN 뒤 commit 직전에 동일 hash의 `final`로 승격하며 SQL 수정 시 candidate와 DB evidence를 다시 만든다. migration은 transaction-local `lock_timeout='2s'`, `statement_timeout='30s'`를 요구하고 과거 migration을 수정하지 않는다.

  migration은 다음 additive columns를 요구한다.

  ```sql
  record_format text not null default 'full_v1'
  change_patch jsonb
  before_hash text
  after_hash text
  event_sequence bigint
  audit_chain_id uuid
  chain_ordinal bigint
  chain_start_kind text
  predecessor_event_id uuid
  predecessor_after_hash text
  ```

  기존/manual rows는 default `full_v1`, 나머지 chain columns null 그대로다. 신규 v2 trigger INSERT/DELETE는 `full_v2` full snapshot, UPDATE는 `diff_v2`와 changed fields만 저장해야 한다. additive columns는 constant fast default/null만 사용하고 existing-row rewrite나 backfill을 금지한다. 별도 `dashboard_private.dashboard_audit_event_sequence_v2` sequence는 새 v2 event의 stable lookup key일 뿐 hash-chain 또는 cross-entity commit order 근거가 아니다. v2 trigger가 entity lock을 얻은 뒤 새 rows에만 `pg_catalog.nextval(...)`을 명시적으로 쓴다. sequence USAGE/SELECT은 PUBLIC/anon/authenticated/service_role에서 revoke한다. shape constraint는 `NOT VALID`로 추가해 기존 table scan을 피하되 새 writes에는 즉시 적용하며, 기존 row validation은 별도 저부하 운영 단계로 남긴다.

  predecessor hot path는 exact partial covering index 하나를 같은 migration에서 trigger 교체 전에 만든다.

  ```sql
  create index dashboard_audit_logs_v2_entity_sequence_idx
    on public.dashboard_audit_logs (entity_table, entity_id, event_sequence desc)
    include (id, action, audit_chain_id, chain_ordinal, after_hash)
    where record_format in ('full_v2', 'diff_v2');
  ```

  기존 이름의 index가 있으면 normalized definition exact equality만 허용하고 drift면 fail-closed한다. 기존 rows는 `full_v1`이라 index entry를 만들지 않지만 heap predicate scan은 발생하므로 30초 statement/2초 lock timeout 안에 못 끝나면 migration 전체를 rollback하고 운영 적용을 별도 저부하 window로 미룬다. timeout을 풀거나 seq-scan fallback으로 trigger를 활성화하지 않는다. trigger predecessor query는 exact `(entity_table,entity_id) = (...) AND record_format IN (...) ORDER BY event_sequence DESC LIMIT 1` shape를 사용한다.

- [ ] **Step 2: patch shape를 고정한다**

  ```json
  {
    "field_name": { "before": "old-json-value", "after": "new-json-value" }
  }
  ```

  실제 JSON value를 보존하고 string으로 이중 encode하지 않는다. 변경되지 않은 key만 제외하며 `updated_at`, `updated_by`를 포함해 실제로 바뀐 key는 모두 기록한다. no-op UPDATE는 empty object patch와 동일한 before/after hash를 가진 `diff_v2` 한 건으로 기록해 기존 audit 행위와 trigger write behavior를 보존한다.

- [ ] **Step 3: immutable patch helpers를 구현한다**

  `dashboard_private.dashboard_audit_reverse_patch_v2(record jsonb, patch jsonb)`와 forward helper는 `security invoker set search_path=''`와 schema-qualified builtins/objects만 사용한다. PUBLIC/anon/authenticated execute를 revoke한다. ordinary update, `updated_at`-only update, null/JSON value update와 두 update chain을 역순 적용하면 매 단계 full-row hash와 최초 row가 일치해야 한다.

- [ ] **Step 4: trigger function을 forward replace한다**

  `dashboard_private.log_dashboard_audit_event_v2()`를 `security definer set search_path=''`로 만들고 모든 object/function을 schema-qualified한다. entity table/id를 계산한 즉시 그 두 값을 SHA-256해 만든 두-int key로 `pg_catalog.pg_advisory_xact_lock`을 얻고 transaction commit까지 유지한다. INSERT는 predecessor query와 무관하게 항상 새 `audit_chain_id`, ordinal 1, `chain_start_kind='insert'`, null predecessor로 시작한다. UPDATE/DELETE만 lock 아래 latest v2 event를 읽는다. latest가 없으면 pre-existing row의 migration-boundary chain을 시작한다. latest가 DELETE이거나 latest `after_hash`가 current `before_hash`와 다르거나 expected predecessor row가 없으면 corrupted/missing history를 새 chain으로 숨기지 않고 transaction을 `audit_chain_continuity_invalid`로 fail-closed한다. valid latest만 기존 chain, ordinal+1, predecessor event ID/after hash로 잇는다. DELETE 뒤 같은 ID INSERT는 INSERT 규칙으로 새 chain이다. global sequence의 인접성이나 다른 entity commit order를 continuity 증거로 사용하지 않는다. INSERT는 `after_record`, DELETE는 `before_record`, UPDATE는 `change_patch`만 저장한다. `before_hash/after_hash`는 trigger가 본 canonical full `jsonb::text` SHA-256이다. 기존 actor/class/request/request-operation/change-reason context와 return behavior를 그대로 유지한다.

  table check constraint는 action/record_format/full snapshots/patch/hash/chain의 허용 조합을 강제한다. `diff_v2`는 `action='UPDATE'`, null full-record columns, JSON object patch(빈 object 허용), 두 hash와 non-null event/chain fields를 요구하고 empty patch이면 hashes가 같아야 한다. `full_v2` INSERT는 only-after/after-hash, DELETE는 only-before/before-hash와 non-null event/chain fields를 요구한다. ordinal 1은 null predecessor와 `insert|migration_boundary` start kind를, ordinal >1은 null start kind와 non-null predecessor ID/hash를 요구한다. DELETE 뒤 같은 chain에 후속 event를 허용하지 않는다. 기존/manual audit rows는 `record_format='full_v1'`, 모든 chain fields null과 기존 shape로 호환한다.

  migration은 NOLOGIN role `dashboard_audit_writer_v2`를 `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`로 만들거나 exact attributes가 다르면 fail-closed한다. private trigger/helper/sequence owner를 이 role로 고정한다. shared `dashboard_private` schema ACL은 migration 전의 모든 pre-existing grantee/privilege를 exact 보존하고, 유일하게 reviewed delta인 `dashboard_audit_writer_v2=USAGE`만 추가한다. writer에는 schema `CREATE`를 주지 않으며 schema default ACL은 byte-normalized exact equality를 유지한다. migration executor의 existing owner/superuser 권한으로 object owner를 바꾸고 writer membership, `SET ROLE`, temporary schema `CREATE`를 grant하지 않는다. 구현상 temporary privilege가 불가피하면 같은 transaction에서 revoke한 뒤 commit 전 catalog assertion으로 0임을 증명하지 못할 경우 migration 전체를 rollback한다. 새 function/sequence/table privileges만 object 단위로 PUBLIC/anon/authenticated/service_role에서 revoke한다. writer에는 audit table의 required SELECT/INSERT columns, sequence 사용, exact called function execute만 grant하고 source tables update/delete, unrelated public tables, role creation 권한은 주지 않는다. 기존 `dashboard_audit_logs_authenticated_insert` policy를 drop하고 authenticated/PUBLIC direct INSERT privilege를 revoke한다. staff/admin SELECT policy는 호환 유지하며 writer 전용 INSERT/SELECT RLS policy를 추가한다. trigger function owner가 broad `postgres`/service_role 권한에 의존하지 않아야 한다.

  exact triggers `dashboard_audit_teacher_catalogs`, `dashboard_audit_profiles`, `dashboard_audit_students`, `dashboard_audit_classes`, `dashboard_audit_textbooks`, `dashboard_audit_class_schedule_slots`, `dashboard_audit_class_lesson_sessions`를 모두 AFTER INSERT OR UPDATE OR DELETE로 재생성해 private v2 function을 가리키게 한다. 의존성이 0임을 확인한 뒤 public old function execute를 PUBLIC/anon/authenticated/service_role에서 revoke하고 drop한다. private function도 PUBLIC/anon/authenticated/service_role direct execute를 revoke한다.

- [ ] **Step 5: pgTAP과 두-client probe로 복구·동시성·ACL을 검증한다**

  일곱 table 각각 INSERT -> no-op UPDATE -> ordinary UPDATE -> timestamp-only UPDATE -> JSON/null UPDATE -> DELETE를 실행하고 audit action/order/context/shape를 검사한다. continuity assertion은 같은 `(entity_table,entity_id,audit_chain_id)`에서 `chain_ordinal>1`인 event만 대상으로 predecessor ID가 직전 ordinal event이고 predecessor after hash가 현재 before hash와 같은지 검사한다. `full_v1 -> v2`는 migration-boundary chain, DELETE -> same-ID INSERT와 no-prior-v2 INSERT는 새 chain/ordinal 1임을 검증한다. predecessor row 삭제 fixture, previous after-hash corruption, closed DELETE chain 뒤 UPDATE는 source mutation도 함께 fail-closed해야 한다. multi-update chain을 ordinal 역순으로 복구하고 매 단계 hash를 전수 검증한다. local-only 20,000-row mixed audit fixture에서 exact predecessor SQL의 `EXPLAIN (FORMAT JSON,ANALYZE false,COSTS false)` plan이 `dashboard_audit_logs_v2_entity_sequence_idx`의 Index Scan 또는 Index Only Scan이고 sort/seq scan이 없는지 검사하며, index definition/predicate/include columns drift도 pgTAP으로 고정한다. 별도 `scripts/probe-dashboard-audit-chain-concurrency.mjs` two-client probe는 harness의 loopback `TASK_LOCAL_DB_URL`에서 같은 row를 두 transaction이 겹쳐 update하게 해 second trigger가 first commit 뒤 predecessor를 잇는지, rollback transaction의 sequence gap이 chain을 깨지 않는지 검증한다. `tests/dashboard-audit-chain-concurrency.test.mjs`는 probe가 local nonce/URL 없이는 fail-closed하고 transaction orchestration/result parser가 drift를 거부하는지 검사한다. 다른 entity의 commit 순서는 assertion 대상이 아니다. wide fixture에서 diff_v2 + chain metadata의 `pg_column_size`가 기존 before+after full보다 작고, direct authenticated insert 및 public/private trigger-function execute가 계속 금지되는지 검사한다. `proowner`, `prosecdef`, empty `proconfig` search path, role attributes, pre-existing schema grantee ACL exact parity + writer의 single `USAGE` delta, unchanged default ACL, temporary privilege 0, new function/sequence ACL, writer의 exact table privileges/RLS policy를 pgTAP으로 고정한다. 대표 pre-existing authenticated/service-role private RPC fixtures도 migration 전후 callable parity를 유지해야 한다. 기존 `full_v1` reader fixture와 schema consumer가 그대로 동작해야 한다.

- [ ] **Step 6: source 회귀와 커밋을 실행한다**

  ```bash
  "$TASK_NODE" --test --experimental-strip-types \
    tests/dashboard-audit-diff-format.test.mjs \
    tests/dashboard-audit-chain-concurrency.test.mjs \
    tests/continuous-class-schedule-release2-schema.test.mjs \
    tests/teacher-account-linking.test.mjs
  "$TASK_NODE" scripts/run-isolated-supabase-db-tests.mjs --execute --authorized --request-id "$TASK_REQUEST_ID" --test supabase/tests/dashboard_audit_diff_format_test.sql --probe scripts/probe-dashboard-audit-chain-concurrency.mjs
  ```

  Commit: `perf: store reversible dashboard audit diffs`

---

### Task 5: 180일 audit archive 후보의 non-destructive preview

**Files:**
- Create: `scripts/preview-dashboard-audit-archive.mjs`
- Create: `tests/dashboard-audit-archive-preview.test.mjs`
- Modify: `docs/runbooks/supabase-resource-pressure.md`

- [ ] **Step 1: non-destructive preview RED 테스트를 작성한다**

  CLI는 env `TASK_ARCHIVE_AS_OF`(RFC3339)와 `TASK_ARCHIVE_PREVIEW_OUTPUT`(absolute path)를 받아 `--as-of "$TASK_ARCHIVE_AS_OF" --mode plan|execute --output "$TASK_ARCHIVE_PREVIEW_OUTPUT" --authorized --request-id "$TASK_REQUEST_ID"`를 사용하고 execute만 output/authorized/request-id를 요구한다. preview는 KST as-of 기준 180일 이전 완료 월만 선택하고 current partial month를 제외한다. 출력은 최대 6개월의 월, min/max changed_at, decimal-string row count, estimated bytes뿐이며 full-row checksum/row content/query text를 stdout/stderr/file에 출력하지 않는다.

- [ ] **Step 2: bounded preview를 구현한다**

  execute는 먼저 catalog에서 global `changed_at`-leading index 존재를 확인하고 `EXPLAIN (FORMAT JSON)`만 실행한다. index가 없거나 plan에 sequential scan이 있거나 estimated rows가 100,000을 넘으면 aggregate를 실행하지 않고 `{available:false,errorCode:"bounded_index_required"}`로 끝낸다. 계획 기준 latest main에는 `(class_id,changed_at,id)` index만 있고 global leading index가 없으므로 expected current result는 이 deferred error다. preview를 가능하게 하려고 index를 이 task에서 추가하지 않는다. 향후 실제 query evidence로 index가 별도 승인된 경우에만 Task 3과 같은 read-only/4초-timeout envelope로 최대 6개 완료 월 aggregate를 읽는다. preview JSON의 결론은 `candidateOnly=true`, `archiveVerified=false`, `deleteAuthorized=false`로 고정한다. 어떤 입력/flag로도 이 세 값을 뒤집을 수 없다.

- [ ] **Step 3: delete 기능을 의도적으로 구현하지 않는다**

  이 task에는 archive row export, restore verifier, `DELETE FROM dashboard_audit_logs`, prune RPC, deletion authorization artifact가 없어야 한다. archive format/schema, canonical event order, encryption, destination, retention owner를 승인받은 뒤 별도 계획에서 full-file checksum과 disposable-schema 전수 restore/reconciliation을 설계한다.

- [ ] **Step 4: GREEN과 커밋을 실행한다**

  Run: `"$TASK_NODE" --test --experimental-strip-types tests/dashboard-audit-archive-preview.test.mjs`

  Commit: `ops: preview dashboard audit archive candidates`

---

### Task 6: query-driven index/RLS triage 경계

**Files:**
- Modify: `docs/runbooks/supabase-resource-pressure.md`
- Modify: `docs/operations/evidence/supabase-free-tier-baseline-template.md`
- Create: `docs/operations/free-tier-performance-migration-scopes.json`
- Test: `tests/free-tier-operational-guardrails.test.mjs`

- [ ] **Step 1: Advisor triage 표를 추가한다**

  각 finding에 exact table/policy/index, 실제 consumer query, pre/post EXPLAIN, role parity, write/storage cost, decision을 기록한다. `fix all` 동작은 runbook에서 금지한다.

- [ ] **Step 2: index 승인 조건을 고정한다**

  query surface 계획이 만든 실제 filter/order/join에만 index를 추가한다. `EXPLAIN`이 index를 사용하지 않으면 migration 후보에서 제거한다. exact duplicate만 dependency 확인 후 drop 후보가 된다.

- [ ] **Step 3: RLS 승인 조건을 고정한다**

  `(select auth.uid())` initplan 전환과 permissive policy 통합은 admin/staff/assistant/teacher/viewer의 allowed/denied fixture row set이 전후 동일할 때만 허용한다.

- [ ] **Step 4: migration batching guard를 추가한다**

  manifest entry는 exact migration path, category `index|rls`, allowed table names, reason, evidence IDs를 가진다. performance migration 하나의 DDL 대상은 최대 3 user tables, `create|drop index` 합계 최대 4, `create|drop policy` 합계 최대 6이다. limit 초과 또는 manifest 밖 table은 CI fail이며 migration을 쪼개거나 별도 승인 manifest commit을 먼저 만든다. SELECT/RPC가 읽는 table 수는 이 DDL threshold에 포함하지 않는다.

- [ ] **Step 5: 커밋한다**

  Commit: `docs: require evidence for database tuning`

---

### Task 7: 구형 notification control plane zero-writer 감사 도구

**Files:**
- Create: `scripts/audit-legacy-notification-dependencies.mjs`
- Create: `tests/legacy-notification-dependency-audit.test.mjs`
- Create: `docs/operations/legacy-notification-object-manifest.json`
- Modify: `docs/runbooks/supabase-resource-pressure.md`

- [ ] **Step 1: dependency categories RED 테스트를 작성한다**

  source imports/routes/RPC strings/migration dependencies, DB function/trigger references, table-write counter deltas, cron active state를 별도 category로 출력해야 한다. 각 section은 `available|unavailable`이고 unavailable은 0이 아니다. code search 0만으로 drop-ready를 주장하지 못하게 한다.

- [ ] **Step 2: read-only auditor를 구현한다**

  manifest는 wildcard/prefix/regex 없이 latest-main catalog의 모든 notification-owned relation/function/trigger/job을 literal로 동결한다. 각 object entry는 `objectType`, schema-qualified name/signature, owner migration, decision `retain|drop_candidate`, retained consumer 또는 replacement evidence ID를 가진다. 최소 핵심 relations는 다음이며 이 목록만으로 exhaustive라고 주장하지 않는다.

  ```text
  public.dashboard_notifications
  public.dashboard_notification_read_receipts
  public.dashboard_push_subscriptions
  dashboard_private.notification_events
  dashboard_private.notification_deliveries
  dashboard_private.notification_event_fanout_jobs
  dashboard_private.notification_rule_reconciliation_jobs
  dashboard_private.notification_target_reconciliation_jobs
  dashboard_private.notification_worker_heartbeats
  dashboard_private.notification_watchdog_heartbeats
  dashboard_private.registration_customer_reminder_jobs
  dashboard_private.registration_customer_reminder_worker_heartbeats
  ```

  manifest builder test는 catalog fixture의 notification-owned object set과 JSON set이 exact equality인지 검증해 누락/extra를 모두 실패시킨다. new lightweight objects는 별도 replacement set이며 legacy manifest에 넣지 않는다.

  evidence contract는 object type별로 다르며 한 counter를 모든 object에 확대 해석하지 않는다.

  - relation: start/end relid와 `pg_stat_user_tables.n_tup_ins|n_tup_upd|n_tup_del`, database reset marker를 기록한다. PostgreSQL은 single-table counter reset에 per-table reset timestamp를 제공하지 않으므로 이 값만으로 `zero_writer_proven`을 만들지 않고 `counter_zero_reset_ambiguous`로 표시한다.
  - function: `track_functions`가 `pl|all`이고 exact function OID가 `pg_stat_user_functions`에 나타나며 calls가 같은 경우에만 `calls_unchanged`다. single-function reset timestamp가 없으므로 destructive proof는 여전히 `unknown`이다. tracking off/missing/OID drift는 unavailable/unknown이다.
  - trigger: `pg_trigger` enabled state, owning relation OID, trigger function OID와 dependency graph를 start/end에 기록한다. enabled trigger의 실제 zero execution은 owning relation의 reset-safe write evidence 없이는 `unknown`이다.
  - cron job: exact job ID/name/schedule/active와 `cron.job_run_details`의 window rows/status/start/end를 사용한다. job ID/schedule drift 또는 history unavailable은 unknown이다.

  exact cron names는 `tips-notification-worker-v1`, `tips-notification-cutover-watchdog-v1`, `tips-registration-customer-reminder-v1`이다. start/end에서 위 object-specific evidence와 `pg_stat_database.stats_reset`, `track_functions`, reset function ACL을 저장한다. global reset marker 불변은 필요조건이지만 single-object reset 부재 증거는 아니다. 어떤 reset ambiguity도 zero로 바꾸지 않는다.

  active dependency scan scope는 `src`, `scripts`, `supabase/functions`, `package.json`, `vercel.json`, `.github/workflows`로 고정하고 generated/build/vendor를 제외한다. immutable `supabase/migrations` reference는 historical provenance category로만 출력하며 active dependency count에 넣지 않는다.

- [ ] **Step 3: drop readiness 조건을 구현한다**

  다음은 destructive review의 필요조건이다.

  - `dashboard_private.lightweight_external_alert_receipt_attestations`의 externally supplied manual attestation에서 provider request와 actual receipt가 각각 true
  - `dashboard_private.lightweight_external_alert_run_ledger`의 overflow/error 0인 successful 10:00 run 최소 1회
  - `dashboard_private.lightweight_external_alert_gates`의 대상 matrix rows가 live
  - start/end에서 exact legacy cron 세 개의 active count 0, job ID/schedule 불변
  - 아래 7일 observation window 동안 exact legacy relation write-counter delta 0이며 reset ambiguity 없음
  - 모든 `drop_candidate` object의 active source/DB dependency 0; `retain` object는 manifest의 exact consumer가 존재
  - archive/retention decision recorded

  observation window는 모든 신규 target gate가 live이고 첫 성공 10:00 run이 끝난 다음 KST 00:00부터 시작해 연속 7일 뒤 KST 00:00에 끝난다. start/end timestamp와 reset marker가 정확히 있어야 하며 중간 restart/stat reset/schema OID change가 있으면 window를 폐기하고 다음 KST 00:00부터 다시 시작한다. evidence freshness는 end 뒤 24시간이며 지나면 `readyForDestructiveReview=false`다. provider/request/receipt input은 cryptographic signature라고 부르지 않고 manual attestation으로 명명하며 `requestId`, `verifiedBy` admin profile, `verifiedAt`, source/event/channel matrix, `providerRequested`, `received`, provider evidence reference를 admin-only RPC가 기록한다. 누락 기본값은 false다.

  report는 object별로 `retain|drop_candidate|unknown`을 출력한다. 이 계획 버전은 reset-safe relation/function/trigger invocation sentinel을 설치하지 않으므로 relation/function/trigger는 counters가 0이어도 `unknown`을 유지하고 global `readyForDestructiveReview=false`다. cron job과 active source dependency만 independently clear될 수 있다. 어떤 section 하나라도 unavailable, stale, reset 또는 interim cron run이면 해당 object와 global readiness는 unknown/false다. 향후 삭제를 검토하려면 별도 승인 계획에서 event-driven statement sentinel 또는 동등한 reset-safe evidence, 설치/제거 migration, I/O budget, observation owner를 먼저 승인해야 한다. 이 auditor는 그 evidence를 추론하거나 sentinel을 설치하지 않는다.

- [ ] **Step 4: destructive SQL을 포함하지 않는다**

  auditor는 report만 만든다. table/function/index drop migration은 별도 사용자 승인 plan에서만 작성한다.

- [ ] **Step 5: GREEN과 커밋을 실행한다**

  Run: `"$TASK_NODE" --test --experimental-strip-types tests/legacy-notification-dependency-audit.test.mjs`

  Commit: `ops: audit legacy notification dependencies`

---

### Task 8: 전체 검증과 source 완료 경계

**Files:**
- Verify: all changed files

- [ ] **Step 1: focused tests를 실행한다**

  ```bash
  "$TASK_NODE" --test --experimental-strip-types \
    tests/free-tier-operational-guardrails.test.mjs \
    tests/supabase-resource-evidence-comparator.test.mjs \
    tests/dashboard-audit-diff-format.test.mjs \
    tests/dashboard-audit-chain-concurrency.test.mjs \
    tests/dashboard-audit-archive-preview.test.mjs \
    tests/legacy-notification-dependency-audit.test.mjs
  "$TASK_PNPM" run verify:free-tier -- --base HEAD --surface all --worktree
  ```

- [ ] **Step 2: 전체 정적 검증을 실행한다**

  ```bash
  "$TASK_NODE" --test --experimental-strip-types tests/*.test.mjs tests/*.node.ts
  "$TASK_PNPM" exec tsc --noEmit --pretty false
  "$TASK_PNPM" eslint src tests middleware.ts next.config.ts
  "$TASK_PNPM" build
  git diff --check
  git status --short
  ```

- [ ] **Step 3: audit migration local DB를 검증한다**

  Run: `"$TASK_NODE" scripts/run-isolated-supabase-db-tests.mjs --execute --authorized --request-id "$TASK_REQUEST_ID" --test supabase/tests/dashboard_audit_diff_format_test.sql --probe scripts/probe-dashboard-audit-chain-concurrency.mjs`

  홈/통계 계획에서 만든 source-controlled `dashboard-free-tier-v1` baseline/manifest harness가 baseline prerequisite smoke test 뒤 ordered 신규 migrations를 unique temp project/ports에 apply하고 pgTAP을 실행한 뒤 exact temp project를 finally teardown한다. blank project에 repository historical migrations를 무작정 replay하거나 일부 migration만 복사하지 않는다. before/after ACL, reversible fixture, chain/concurrency, byte comparison을 검증하고 production data를 local fixture로 복사하지 않는다.

- [ ] **Step 4: source 완료를 커밋하고 멈춘다**

  Commit: `test: verify Supabase free tier guardrails`

## Separately Authorized Operations

1. production read-only baseline 수집
2. audit diff migration 적용과 새 행 format/size 확인
3. query-surface migrations별 EXPLAIN/role parity/index 적용
4. `main` push와 Vercel Production 확인
5. 30분/업무 피크 resource delta 관찰
6. external archive destination/encryption owner 승인
7. 180일 초과 archive export와 restore rehearsal
8. exact row delete 별도 destructive 승인
9. legacy notification zero-writer observation
10. legacy schema drop 별도 destructive migration 승인
