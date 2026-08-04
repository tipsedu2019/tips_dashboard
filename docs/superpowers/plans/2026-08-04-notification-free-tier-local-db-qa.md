# 알림 콘텐츠 무료 티어 로컬 DB QA 구현 계획

**Goal:** Supabase Pro·Preview Branch 없이 운영 schema와 migration metadata만 읽고, egress가 차단된 일회성 로컬 Docker DB에서 합성 fixture·저장 왕복·pgTAP 10개를 검증한다.

**Architecture:** 기존 preview branch orchestrator를 먼저 실행 불가능한 무료 티어 계약으로 전환한다. 그 뒤 remote read-only collector, synthetic configuration fixture, local Docker builder와 cleanup을 각각 독립적으로 구현한다. 운영 DB에는 schema-only dump와 `begin read only` metadata query만 허용하고, 모든 mutation은 실행별 고유 project id·port·internal network를 가진 로컬 DB에만 허용한다.

**Tech Stack:** Node.js 24, Supabase CLI 2.103.0, Docker Desktop, PostgreSQL 17 또는 remote-compatible major, pgTAP, `node:test`.

## Global constraints

- Supabase Free 요금제를 유지하고 Preview Branch command를 사용하지 않는다.
- 운영 DB mutation, 운영 row 복사, data-only dump, provider 실발송은 0건이다.
- remote DB password는 `SUPABASE_DB_PASSWORD` child environment에만 존재하며 argv·stdout·evidence·Git 파일에 기록하지 않는다.
- remote metadata SQL은 `begin read only`로 실행한다. schema dump는 exact schema-only CLI invocation으로 제한한다.
- local Docker network는 `--internal`로 만들고 DB·pgTAP runner 외의 egress를 허용하지 않는다.
- settings UI flag만 disposable transaction 안에서 임시 true를 허용한다. dispatch/provider flag는 전 구간 false다.
- 실제 실행 전 같은 exact QA label의 container·volume·network가 있으면 attach하거나 정리하지 않고 중단한다.
- cleanup은 실행 manifest가 소유한 exact resource만 대상으로 하고 primary failure와 cleanup failure를 모두 보존한다.
- 사용자 소유 미추적 파일 `docs/superpowers/plans/2026-08-01-registration-notion-status-open-fields.md`는 수정·스테이징하지 않는다.
- 각 Task는 테스트 → 구현 → 회귀 → diff 확인 → commit 후 멈춘다.

---

## Task 1: Preview Branch 능력을 제거하고 무료 티어 계약으로 fail-closed 전환

**Files:**

- Modify: `scripts/run-notification-isolated-db-qa.mjs`
- Modify: `tests/notification-isolated-db-qa.test.mjs`

**Interfaces:**

- Produces: `assertLinkedProjectMetadata(value)`
- Produces: `normalizeRemoteMigrationVersions(payload, localFiles)`
- Produces: `derivePendingMigrationFiles(remoteMigrations, localFiles)`
- Produces: `assertLocalMutationTarget(value, expectedPort)`
- Retains: `redactCommandEvidence(value)`
- CLI plan contract: `--execute --approved-local-db`

### Step 1: 새 계약 RED 테스트 작성

- linked metadata는 exact production ref와 허용 region만 보존하고 credential·추가 필드를 제거한다.
- remote migration version은 14자리, unique, sorted, repository-known prefix여야 한다.
- remote-only version, remote 중간 누락, remote max보다 오래된 local-only migration을 drift로 거부한다.
- pending 결과는 remote max보다 새로운 local file만 exact path와 SHA-256 identity로 반환한다.
- local mutation target은 expected dynamic port의 `127.0.0.1`, `localhost`, `::1`만 허용한다.
- production host, 다른 port, `host.docker.internal`, credential이 든 URL은 거부한다.
- 기본 CLI는 자원을 만들지 않는 free-tier plan JSON을 출력한다.
- 누락된 flag, 기존 `--approved-preview-branch`, 새 full flag 모두 child process 0건이어야 한다.
- 새 full flag는 아직 `notification_local_db_runner_not_implemented`로 종료한다.
- source에는 `branches list|create|get|delete` command literal이 남지 않는다.
- secret redaction 회귀가 유지된다.

Run:

```bash
$TASK_NODE --test tests/notification-isolated-db-qa.test.mjs
```

Expected: RED.

### Step 2: 기존 branch runner를 작은 fail-closed skeleton으로 교체

- Preview Branch constant, metadata parser, polling, branch DB URL, branch cleanup을 삭제한다.
- pure contract helper만 구현한다.
- `planEvidence()`는 다음 의미를 가진다.

```json
{
  "mode": "plan",
  "approved": false,
  "requiredFlags": ["--execute", "--approved-local-db"],
  "expectedResources": {
    "previewBranches": 0,
    "productionRowDataCopied": 0,
    "productionMutationCount": 0,
    "localDatabaseProjectPattern": "tips_notification_db_qa_<random>",
    "localDatabasePort": "dynamic-loopback",
    "internalDockerNetwork": true,
    "pgTapFileCount": 10,
    "providerEgressBlocked": true
  }
}
```

- exact 새 full flag도 Task 4 전까지 executor를 호출하지 않고 fail-closed로 종료한다.

### Step 3: Task 1 검증

```bash
$TASK_NODE --test tests/notification-isolated-db-qa.test.mjs
$TASK_NODE --experimental-strip-types scripts/run-notification-isolated-db-qa.mjs
$TASK_NODE --experimental-strip-types scripts/run-notification-isolated-db-qa.mjs --execute --approved-local-db
git diff --check
git diff -- scripts/run-notification-isolated-db-qa.mjs tests/notification-isolated-db-qa.test.mjs
```

Expected: unit PASS, plan exit 0, full new flags exit 1, external command 0, branch command literal 0.

### Step 4: Commit and stop

```bash
git add scripts/run-notification-isolated-db-qa.mjs tests/notification-isolated-db-qa.test.mjs
git commit -m "refactor: lock notification QA to free tier"
```

---

## Task 2: Remote read-only collector와 migration drift manifest 구현

**Files:**

- Modify: `scripts/run-notification-isolated-db-qa.mjs`
- Modify: `tests/notification-isolated-db-qa.test.mjs`

**Interfaces:**

- Produces: `collectRemoteSchemaMetadata(context, execute)`
- Produces: `buildPendingMigrationManifest(remote, local)`
- Runtime-only: schema dump와 metadata JSON을 mode `0600` temp file로 생성

### Requirements

- Docker 시작 전에 `SUPABASE_DB_PASSWORD` 존재를 boolean으로만 확인한다.
- password 없는 remote DB target과 password environment를 사용하고 `--password` argv는 금지한다.
- remote query file은 migration version/name, `server_version_num`, extension name/version, required role/schema/catalog만 읽는다.
- query file은 `begin read only; ... rollback;`을 포함한다.
- schema dump는 `public,dashboard_private`, output file만 허용하고 `--data-only`, `--use-copy`, `--role-only`를 금지한다.
- remote/local migration set은 version/name으로 엄격히 비교하고 pending local file path/hash manifest를 만든다.
- collector 결과에 password, DB URL, token, provider secret, row data를 포함하지 않는다.
- 이 Task에서는 main executor를 아직 연결하지 않아 실제 remote·Docker command 0건을 유지한다.

### Tests

- credential missing fail-before-child
- exact remote query/dump allowlist
- query SQL read-only contract
- schema dump no-data contract
- server version/extension/role parser
- duplicate/gap/remote-only/old-local drift rejection
- deterministic pending path/SHA-256 manifest
- remote stderr redaction

### Verification and commit

```bash
$TASK_NODE --test tests/notification-isolated-db-qa.test.mjs
git diff --check
git diff -- scripts/run-notification-isolated-db-qa.mjs tests/notification-isolated-db-qa.test.mjs
git add scripts/run-notification-isolated-db-qa.mjs tests/notification-isolated-db-qa.test.mjs
git commit -m "feat: add notification QA read-only collector"
```

---

## Task 3: 합성 설정 fixture와 pgTAP 10개 계약 구현

**Files:**

- Create: `supabase/tests/fixtures/notification_content_local_qa_fixture.sql`
- Create: `scripts/notification-content-local-qa-fixture.mjs`
- Create: `tests/notification-content-local-qa-fixture.test.mjs`
- Modify: `scripts/run-notification-isolated-db-qa.mjs`
- Modify: `tests/notification-isolated-db-qa.test.mjs`

**Interfaces:**

- Produces: deterministic fixture manifest `{ version, sqlSha256, identities, expectedCounts }`
- Produces: exact pgTAP allowlist with 10 files

### Requirements

- fixture는 schema-only DB에서 round-trip에 필요한 workflow/event/registry/rule/template/content-contract/legacy setting을 만든다.
- 모든 UUID는 고정 fixture namespace에서 결정적으로 생성한다.
- 합성 email은 `runtime.invalid`만 사용한다.
- 학생, 수업, delivery, inbox, webhook, connection secret row를 만들지 않는다.
- 합성 auth user/profile 수와 설정 identity를 manifest에 고정한다.
- SQL은 source review로 실제 도메인 이름·전화번호·URL·provider secret이 없음을 검사한다.
- 설치 전 zero-count와 설치 후 exact-count query를 제공한다.
- `notification_system_template_vnext_test.sql`을 10번째 pgTAP으로 추가한다.
- round-trip의 UI-only flag 임시 활성화와 rollback 후 all-false를 별도 assertion한다.

### Tests and commit

```bash
$TASK_NODE --test tests/notification-content-local-qa-fixture.test.mjs
$TASK_NODE --test tests/notification-isolated-db-qa.test.mjs
$TASK_NODE --test --experimental-strip-types tests/notification-content-no-send-qa.test.mjs
git diff --check
git add supabase/tests/fixtures/notification_content_local_qa_fixture.sql scripts/notification-content-local-qa-fixture.mjs tests/notification-content-local-qa-fixture.test.mjs scripts/run-notification-isolated-db-qa.mjs tests/notification-isolated-db-qa.test.mjs
git commit -m "test: add synthetic notification DB fixture"
```

---

## Task 4: egress 차단 로컬 Docker builder·evidence·cleanup 구현

**Files:**

- Modify: `scripts/run-notification-isolated-db-qa.mjs`
- Modify: `tests/notification-isolated-db-qa.test.mjs`

### Runtime manifest

- project id: `tips_notification_db_qa_<random suffix>`
- free loopback DB port
- internal Docker network name
- temp root
- pending migration path/hash list
- owned container·volume·network label/name set

### Orchestration

1. pre-existing exact-label resource 0 확인
2. Docker `--internal` network 생성
3. empty migration directory로 DB-only runtime 시작
4. public default privilege precondition 적용
5. remote schema-only SQL을 local DB에 restore
6. owner·grant·RLS·extension postflight
7. verified remote versions만 local `migration repair --status applied`
8. exact pending files만 temp migrations로 복사
9. runtime activation scan
10. local dry-run·actual migration push
11. synthetic fixture 설치·manifest 확인
12. egress/worker/queue/flag preflight
13. read-only evidence
14. disposable round-trip
15. pgTAP 10개
16. egress/worker/queue/flag postflight
17. exact cleanup과 resource 0 확인

### Safety requirements

- remote child env와 local/Node/Docker env를 분리한다.
- local env에는 `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, Google Chat/provider env가 없어야 한다.
- start 호출 전 `localStartAttempted = true`를 기록한다.
- partial start, restore, migration, fixture, evidence, pgTAP 각 실패를 mock하고 cleanup 1회를 검증한다.
- SIGINT·SIGTERM은 same cleanup controller로 들어간다.
- source error와 cleanup error를 `{ primaryCode, cleanupCode }` 안전 evidence로 보존한다.
- main은 이 Task에서만 `--execute --approved-local-db`를 실제 orchestrator에 연결한다.

### Tests and commit

```bash
$TASK_NODE --test tests/notification-isolated-db-qa.test.mjs
$TASK_NODE --test tests/notification-content-local-qa-fixture.test.mjs
$TASK_NODE --test --experimental-strip-types tests/notification-content-no-send-qa.test.mjs
$TASK_NODE --experimental-strip-types scripts/run-notification-isolated-db-qa.mjs
git diff --check
git add scripts/run-notification-isolated-db-qa.mjs tests/notification-isolated-db-qa.test.mjs
git commit -m "feat: run notification QA on isolated local DB"
```

실제 remote·Docker call은 이 Task의 unit test에서 fake executor만 사용한다.

---

## Task 5: 실제 무료 티어 일회성 QA와 강제 정리

**Files:** Runtime only; Git 파일 수정 없음.

### Preflight

```bash
git status --short --branch
docker version --format '{{.Server.Version}}'
docker ps -a --filter label=notification_content_local_qa --format '{{.ID}} {{.Names}} {{.Status}}'
```

- `SUPABASE_DB_PASSWORD`는 존재 여부만 확인하고 출력하지 않는다.
- remote internet 연결과 schema-only 접근을 local resource 시작 전에 확인한다.
- 기존 QA label resource가 있으면 자동 삭제하지 않고 중단한다.

### Execute

```bash
$TASK_NODE --experimental-strip-types scripts/run-notification-isolated-db-qa.mjs --execute --approved-local-db
```

Expected: Free mode, production mutation/row copy 0, migration drift PASS, exact pending apply PASS, fixture PASS, read-only/round-trip PASS, pgTAP 10/10, egress blocked, provider worker 0, queue delta 0, pre/post dispatch flags 0, cleanup resource 0.

### Independent cleanup verification

```bash
docker ps -a --filter label=notification_content_local_qa --format '{{.ID}} {{.Names}} {{.Status}}'
docker volume ls --filter label=notification_content_local_qa --format '{{.Name}}'
docker network ls --filter label=notification_content_local_qa --format '{{.ID}} {{.Name}}'
git status --short --branch
```

실패 시 그 단계의 안전한 error code만 보고하고 별도 버그 Task를 승인받기 전 코드를 수정하지 않는다.

---

## Task 6: 전체 회귀와 다음 release gate 정리

**Files:** 검증 결과에 따라 없음. 버그가 있으면 별도 승인 Task로 분리.

```bash
$TASK_NODE --test tests/notification-isolated-db-qa.test.mjs
$TASK_NODE --test tests/notification-content-local-qa-fixture.test.mjs
$TASK_NODE --test --experimental-strip-types tests/notification-content-no-send-qa.test.mjs
$TASK_NODE --test --experimental-strip-types tests/notification-content-contract.test.mjs
$TASK_NODE --test --experimental-strip-types tests/notification-content-manifest.test.mjs
$TASK_NODE --test --experimental-strip-types tests/notification-system-template-vnext.test.mjs
$TASK_NODE --test --experimental-strip-types tests/dashboard-notification-content.test.mjs
git diff --check
git status --short --branch
```

이 gate가 통과해도 운영 migration, push/deploy, rule 활성화, provider send를 완료로 간주하지 않는다. 각각 별도 승인으로 남긴다.
