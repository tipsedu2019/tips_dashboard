# 알림 콘텐츠 격리 DB QA 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영 데이터와 운영 알림 공급자를 건드리지 않고 완전한 스키마를 가진 일회성 Supabase preview branch에서 안전한 기준본을 만든 뒤, 실제 저장 왕복과 pgTAP은 로컬 Docker DB에서 완료해 Task 15의 미충족 DB lane을 닫는다.

**Architecture:** 데이터 복제가 꺼진 비영구 preview branch를 한 개만 만들고 로컬 마이그레이션을 그 branch에 적용한다. branch가 운영 데이터·연결 비밀·활성 런타임 플래그를 갖지 않았음을 먼저 증명한 뒤 `public,dashboard_private`의 스키마와 시스템 seed만 임시 파일로 덤프하고, 마이그레이션이 없는 별도 Supabase workdir의 로컬 Postgres에 복원한다. 실제 `notification-content-db-evidence.mjs` 왕복과 pgTAP은 이 로컬 DB에서 실행하고, 성공·실패와 무관하게 정확한 preview branch·로컬 컨테이너·임시 덤프를 정리한다.

**Tech Stack:** Node.js 24, Supabase CLI 2.103.0, Supabase Preview Branches, Docker Desktop 4.85.0, PostgreSQL 17, pgTAP, `node:test`.

## Global Constraints

- 실행 셸은 `TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`와 `SUPABASE_CLI=/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase`를 사용한다.
- 이 계획 실행 전 사용자가 preview branch 생성·마이그레이션 적용·삭제를 명시적으로 승인해야 한다.
- 부모 프로젝트 ref는 `slnjqlzzhewblvttiidk`로 고정하고, branch ref가 부모 ref와 같으면 모든 쓰기를 거부한다.
- branch 생성 명령에는 `--with-data`와 `--persistent`를 절대 넣지 않는다.
- branch는 `ap-northeast-2`, `nano`, 비영구 구성으로 한 개만 만든다.
- 운영 프로젝트에 `link`, `db push`, `migration repair`, `db reset`, SQL mutation을 실행하지 않는다.
- preview branch는 운영 데이터를 복제하지 않으며, 사전 점검에서 사용자·학생·수업·알림 전달 row가 하나라도 발견되면 덤프 전에 중단하고 branch를 삭제한다.
- Google Chat URL 평문·암호문, Supabase key, DB password, access token은 stdout/stderr·JSON evidence·Git 파일에 기록하지 않는다.
- 모든 알림 runtime flag는 false여야 하며 cron·worker·provider를 시작하지 않는다.
- 실제 Google Chat, FCM, Web Push, SOLAPI 요청을 보내지 않는다.
- 임시 로컬 DB와 preview branch의 쓰기는 QA fixture와 migration apply로 제한한다.
- Task 16은 이 계획의 DB 왕복·pgTAP·provider-zero·정리 증거가 모두 PASS인 뒤 별도 승인으로 시작한다.
- 사용자 소유 미추적 파일 `docs/superpowers/plans/2026-08-01-registration-notion-status-open-fields.md`는 스테이징하지 않는다.

---

## File Structure

- Create: `scripts/run-notification-isolated-db-qa.mjs`
  - preview branch 생성·검증·덤프·로컬 복원·QA·정리를 한 fail-closed orchestrator로 관리한다.
- Create: `tests/notification-isolated-db-qa.test.mjs`
  - branch metadata, 명령 allowlist, secret redaction, cleanup identity, preflight 결과를 외부 요청 없이 검증한다.
- Modify: `package.json`
  - 승인 플래그가 없으면 외부 상태를 바꾸지 않는 수동 QA entrypoint를 추가한다.
- Runtime-only: ``resolve(tmpdir(), `tips-notification-db-qa-${buildUtcStamp(now)}`)``
  - branch schema/data dump와 빈 Supabase workdir을 보관하고 항상 삭제한다. Git에는 들어가지 않는다.

---

### Task 1: Preview branch 경계를 순수 함수와 RED 테스트로 고정

**Files:**

- Create: `scripts/run-notification-isolated-db-qa.mjs`
- Create: `tests/notification-isolated-db-qa.test.mjs`

**Interfaces:**

- Produces: `normalizePreviewBranchList(payload): PreviewBranch[]`
- Produces: `assertDisposablePreviewBranch(branch, parentProjectRef): PreviewBranch`
- Produces: `redactCommandEvidence(value): string`
- Produces: `buildPreviewBranchName(now): string`
- `PreviewBranch`는 `{ id, name, projectRef, parentProjectRef, isDefault, persistent, withData, status }`만 보존한다.

- [x] **Step 1: branch metadata RED 테스트 작성**

```js
test("preview branch는 부모와 다른 data-less 비영구 환경만 허용한다", async () => {
  const module = await import("../scripts/run-notification-isolated-db-qa.mjs")
  const branch = module.assertDisposablePreviewBranch({
    id: "fbdf5a53-161e-4460-98ad-0e39408d8689",
    name: "qa-notification-content-20260804093000",
    projectRef: "abcdefghijklmnopqrst",
    parentProjectRef: "slnjqlzzhewblvttiidk",
    isDefault: false,
    persistent: false,
    withData: false,
    status: "ACTIVE_HEALTHY",
  }, "slnjqlzzhewblvttiidk")
  assert.equal(branch.projectRef, "abcdefghijklmnopqrst")
})

for (const patch of [
  { projectRef: "slnjqlzzhewblvttiidk" },
  { isDefault: true },
  { persistent: true },
  { withData: true },
  { status: "MIGRATIONS_FAILED" },
]) {
  test(`preview branch 거부: ${JSON.stringify(patch)}`, async () => {
    const module = await import("../scripts/run-notification-isolated-db-qa.mjs")
    assert.throws(() => module.assertDisposablePreviewBranch({
      id: "fbdf5a53-161e-4460-98ad-0e39408d8689",
      name: "qa-notification-content-20260804093000",
      projectRef: "abcdefghijklmnopqrst",
      parentProjectRef: "slnjqlzzhewblvttiidk",
      isDefault: false,
      persistent: false,
      withData: false,
      status: "ACTIVE_HEALTHY",
      ...patch,
    }, "slnjqlzzhewblvttiidk"), /notification_preview_branch_refused/)
  })
}
```

- [x] **Step 2: RED 확인**

Run:

```bash
"$TASK_NODE" --test tests/notification-isolated-db-qa.test.mjs
```

Expected: FAIL because `run-notification-isolated-db-qa.mjs` and its exported guards do not exist.

- [x] **Step 3: 최소 branch guard 구현**

```js
const ACTIVE_PREVIEW_STATUSES = new Set(["ACTIVE_HEALTHY"])

export function assertDisposablePreviewBranch(branch, parentProjectRef) {
  const valid = branch
    && branch.parentProjectRef === parentProjectRef
    && branch.projectRef !== parentProjectRef
    && branch.isDefault === false
    && branch.persistent === false
    && branch.withData === false
    && ACTIVE_PREVIEW_STATUSES.has(branch.status)
  if (!valid) throw new Error("notification_preview_branch_refused")
  return Object.freeze({ ...branch })
}
```

`normalizePreviewBranchList`는 Management API의 `id`, `name`, `project_ref`, `parent_project_ref`, `is_default`, `persistent`, `with_data`, `status`만 읽고 나머지 필드는 버린다. `redactCommandEvidence`는 PostgreSQL URL의 username/password, `sbp_` access token, Google Chat URL query를 `[redacted]`로 치환한다.

- [x] **Step 4: 외부 요청 없는 GREEN 확인**

Run:

```bash
"$TASK_NODE" --test tests/notification-isolated-db-qa.test.mjs
```

Expected: PASS, Supabase API call 0, child process call 0.

- [x] **Step 5: Task 1 diff 확인**

Run:

```bash
git diff --check
git diff -- scripts/run-notification-isolated-db-qa.mjs tests/notification-isolated-db-qa.test.mjs
```

Expected: whitespace error 0, 외부 실행 코드는 아직 없음.

Stop for review before adding branch creation.

---

### Task 2: 승인형 preview-to-local orchestrator 구현

**Files:**

- Modify: `scripts/run-notification-isolated-db-qa.mjs`
- Modify: `tests/notification-isolated-db-qa.test.mjs`
- Modify: `package.json`

**Interfaces:**

- Consumes: Task 1의 branch guard와 redactor.
- Produces: `runNotificationIsolatedDbQa({ approved, cliPath, nodePath, now, execute }): Promise<SafeEvidence>`
- Produces: `SafeEvidence`의 공개 필드는 branch name, branch ref 앞 6자, runtime flags, zero-counts, 로컬 DB 결과, pgTAP 결과, cleanup 결과뿐이다.

- [ ] **Step 1: 명령 allowlist·승인 gate RED 테스트 작성**

허용 명령은 다음 exact family로 제한한다.

```text
supabase branches list --project-ref slnjqlzzhewblvttiidk
supabase branches create $QA_BRANCH_NAME --project-ref slnjqlzzhewblvttiidk --region ap-northeast-2 --size nano
supabase branches get $QA_BRANCH_REF --project-ref slnjqlzzhewblvttiidk
supabase db push --db-url $QA_BRANCH_DB_URL --dry-run --include-all
supabase db push --db-url $QA_BRANCH_DB_URL --include-all
supabase db query --db-url $QA_BRANCH_DB_URL --file $QA_PREFLIGHT_SQL
supabase db dump --db-url $QA_BRANCH_DB_URL --schema public,dashboard_private --file $QA_SCHEMA_SQL
supabase db dump --db-url $QA_BRANCH_DB_URL --schema public,dashboard_private --data-only --use-copy --file $QA_DATA_SQL
supabase db start
supabase db query --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres --file $QA_SCHEMA_SQL
supabase db query --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres --file $QA_DATA_SQL
supabase test db --db-url postgresql://postgres:postgres@host.docker.internal:54322/postgres supabase/tests/notification_control_plane_schema_test.sql supabase/tests/notification_content_contract_test.sql supabase/tests/notification_makeup_single_writer_test.sql supabase/tests/notification_control_plane_runtime_test.sql supabase/tests/notification_ops_task_adapters_test.sql supabase/tests/notification_registration_handoffs_test.sql supabase/tests/notification_transfer_withdrawal_adapters_test.sql supabase/tests/notification_makeup_adapter_test.sql supabase/tests/notification_approval_adapter_test.sql
supabase stop --project-id tips_notification_db_qa --no-backup
supabase branches delete $QA_BRANCH_REF --project-ref slnjqlzzhewblvttiidk --yes
```

테스트는 `approved: false`일 때 첫 child process 전에 `notification_preview_approval_required`가 발생하는지, production ref를 DB URL에 넣으면 `notification_preview_production_target_refused`가 발생하는지 확인한다.

- [ ] **Step 2: RED 확인**

Run:

```bash
"$TASK_NODE" --test tests/notification-isolated-db-qa.test.mjs
```

Expected: FAIL on missing approval gate and command policy.

- [ ] **Step 3: preview branch 생성과 건강 상태 대기 구현**

`branches list`가 빈 배열이거나 같은 이름이 없음을 확인한 뒤 다음 명령을 child process로 실행한다.

```bash
"$SUPABASE_CLI" branches create "$QA_BRANCH_NAME" \
  --project-ref slnjqlzzhewblvttiidk \
  --region ap-northeast-2 \
  --size nano \
  --output-format json
```

`--with-data`, `--persistent`, `--notify-url`은 넣지 않는다. 생성 직후 ref를 메모리에 보관하고, `branches get`을 최대 10분 동안 15초 간격으로 조회한다. `ACTIVE_HEALTHY` 외 terminal failure면 중단한다. 대기 중 사용자 업데이트 간격은 60초를 넘기지 않는다.

- [ ] **Step 4: branch 데이터·공급자 사전 점검 구현**

branch DB에서 다음 safe aggregate만 읽는다.

```sql
begin read only;
select jsonb_build_object(
  'auth_users', (select count(*) from auth.users),
  'profiles', (select count(*) from public.profiles),
  'students', (select count(*) from public.students),
  'classes', (select count(*) from public.classes),
  'deliveries', coalesce((select count(*) from dashboard_private.notification_deliveries), 0),
  'inbox', coalesce((select count(*) from public.dashboard_notifications), 0),
  'runtime_flags_enabled', coalesce((select count(*) from dashboard_private.notification_runtime_flags where enabled), 0),
  'connection_secret_rows', coalesce((
    select count(*) from public.google_chat_webhook_settings
    where nullif(btrim(webhook_url), '') is not null
       or webhook_url_ciphertext is not null
  ), 0)
) as notification_preview_preflight;
rollback;
```

`auth_users`, `profiles`, `students`, `classes`, `deliveries`, `inbox`, `runtime_flags_enabled`, `connection_secret_rows`가 모두 0이 아니면 dump와 migration push를 실행하지 않고 정리 단계로 이동한다. relation이 아직 없으면 migration push 전 preflight는 base business 네 항목만 검사하고, push 후 전체 여덟 항목을 다시 검사한다.

- [ ] **Step 5: preview branch에만 migration dry-run과 apply 구현**

branch metadata의 ref와 DB hostname이 동일한지 다시 검사한 뒤 `db push --dry-run --include-all`을 실행한다. dry-run SQL에 `notification_worker_schedule`, `cron.schedule`, runtime flag `true`가 있으면 actual push를 거부한다. 통과하면 같은 exact branch URL에 `db push --include-all`을 한 번 실행하고 migration list를 재확인한다.

- [ ] **Step 6: schema·system seed dump와 로컬 복원 구현**

전체 preflight가 0인 branch에서 `public,dashboard_private` schema dump와 data-only dump를 mode `0600` 임시 파일로 만든다. 임시 workdir의 `supabase/config.toml`은 project id `tips_notification_db_qa`, DB port `54322`, Postgres major `17`로 고정하고 migrations 폴더는 비워 둔다. `supabase db start` 후 schema dump, data dump 순서로 로컬 URL에 적용한다.

복원 후에는 preview URL을 더 이상 사용하지 않고 다음을 로컬 DB에 실행한다.

```bash
NOTIFICATION_CONTENT_DB_SCOPE=local \
SUPABASE_CLI_PATH="$SUPABASE_CLI" \
"$TASK_NODE" scripts/notification-content-db-evidence.mjs \
  --mode read-only \
  --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres

NOTIFICATION_CONTENT_DB_SCOPE=local \
SUPABASE_CLI_PATH="$SUPABASE_CLI" \
"$TASK_NODE" scripts/notification-content-db-evidence.mjs \
  --mode round-trip \
  --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  --disposable
```

- [ ] **Step 7: 정확한 아홉 pgTAP 실행**

```bash
"$SUPABASE_CLI" test db \
  --db-url postgresql://postgres:postgres@host.docker.internal:54322/postgres \
  supabase/tests/notification_control_plane_schema_test.sql \
  supabase/tests/notification_content_contract_test.sql \
  supabase/tests/notification_makeup_single_writer_test.sql \
  supabase/tests/notification_control_plane_runtime_test.sql \
  supabase/tests/notification_ops_task_adapters_test.sql \
  supabase/tests/notification_registration_handoffs_test.sql \
  supabase/tests/notification_transfer_withdrawal_adapters_test.sql \
  supabase/tests/notification_makeup_adapter_test.sql \
  supabase/tests/notification_approval_adapter_test.sql
```

Expected: 모든 파일 PASS, 각 파일 transaction rollback, provider request 0.

- [ ] **Step 8: package entrypoint 추가**

```json
{
  "verify:notification-content:isolated-db": "node --experimental-strip-types scripts/run-notification-isolated-db-qa.mjs"
}
```

실제 실행에는 CLI에서 `--execute --approved-preview-branch` 두 플래그를 모두 요구한다. 플래그가 없으면 계획·필요 권한·예상 생성 자원만 JSON으로 출력하고 exit 0한다.

- [ ] **Step 9: mock GREEN 확인**

Run:

```bash
"$TASK_NODE" --test tests/notification-isolated-db-qa.test.mjs
"$TASK_NODE" --test --experimental-strip-types tests/notification-content-no-send-qa.test.mjs
```

Expected: 외부 요청 없이 PASS, secret fixture 문자열은 stdout/stderr에 없음.

Stop for explicit approval before the real preview run.

---

### Task 3: 실제 일회성 preview QA와 강제 정리

**Files:**

- Runtime only; Git 파일 수정 없음.

**Interfaces:**

- Consumes: Task 2의 승인형 orchestrator.
- Produces: branch-safe evidence JSON과 local DB/pgTAP 결과.

- [ ] **Step 1: 실행 직전 상태 고정**

```bash
git status --short --branch
"$SUPABASE_CLI" branches list \
  --project-ref slnjqlzzhewblvttiidk \
  --output-format json
docker version --format '{{.Server.Version}}'
```

Expected: 작업 트리는 승인된 파일과 사용자 미추적 계획만 포함, 같은 이름 branch 0, Docker server reachable.

- [ ] **Step 2: 승인 플래그로 한 번 실행**

```bash
"$TASK_NODE" --experimental-strip-types scripts/run-notification-isolated-db-qa.mjs \
  --execute \
  --approved-preview-branch
```

Expected evidence:

```json
{
  "passed": true,
  "productionMutationCount": 0,
  "productionDataRowCount": 0,
  "externalProviderRequestCount": 0,
  "runtimeFlagsEnabled": 0,
  "dbReadOnlyPassed": true,
  "dbRoundTripPassed": true,
  "pgTapFileCount": 9,
  "pgTapFailureCount": 0,
  "localCleanupPassed": true,
  "previewCleanupPassed": true
}
```

- [ ] **Step 3: 실패 여부와 무관한 정리 확인**

orchestrator의 `finally`는 생성 때 받은 exact branch ref만 삭제하고, project ref 전체 삭제나 production branch 삭제를 호출하지 않는다. 로컬 정리는 project id `tips_notification_db_qa`만 `stop --no-backup`하고, ``resolve(tmpdir(), `tips-notification-db-qa-${buildUtcStamp(now)}`)``로 계산한 exact 디렉터리만 삭제한다.

```bash
"$SUPABASE_CLI" branches list \
  --project-ref slnjqlzzhewblvttiidk \
  --output-format json
docker ps -a --filter name=supabase_db_tips_notification_db_qa \
  --format '{{.Names}}|{{.Status}}'
```

Expected: 생성한 branch 0, QA 컨테이너 0. 삭제 실패 시 Task 16을 시작하지 않고 exact branch name/ref만 사용자에게 보고한다.

---

### Task 4: 전체 회귀·diff·커밋 후 Task 16 앞에서 정지

**Files:**

- `scripts/run-notification-isolated-db-qa.mjs`
- `tests/notification-isolated-db-qa.test.mjs`
- `package.json`

- [ ] **Step 1: Task 15 전체 코드 lane 재실행**

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/notification-content-*.test.mjs \
  tests/notification-*-presentation.test.mjs \
  tests/dashboard-notification-content.test.mjs \
  tests/notification-control-plane-*.test.mjs \
  tests/notification-workflow-registry.test.mjs \
  tests/notification-workflow-entrypoints.test.mjs \
  tests/notification-ops-task-producers.test.mjs \
  tests/registration-notification-adapter.test.mjs \
  tests/registration-appointment-reminders.test.mjs \
  tests/registration-consultation-notification.test.mjs \
  tests/notification-registration-handoffs.test.mjs \
  tests/word-retest-expected-at.test.mjs \
  tests/notification-transfer-withdrawal-adapters.test.mjs \
  tests/notification-makeup-adapter.test.mjs \
  tests/makeup-request-workspace.test.mjs \
  tests/notification-approval-adapter.test.mjs \
  tests/notification-control-plane-worker.test.mjs \
  tests/notification-google-chat-content.test.mjs \
  tests/notification-google-chat-connection-catalog.test.mjs \
  tests/notification-external-attempt-gate.test.mjs \
  tests/notification-science-provider-zero.test.mjs \
  tests/notification-shadow-preview-fixture-runner.test.mjs \
  tests/notification-shadow-fixture-runner.test.mjs
"$TASK_NODE" --experimental-strip-types scripts/run-notification-content-no-send-qa.mjs
"$TASK_NODE" --test tests/supabase-migration-layout.test.mjs
```

Expected: failure 0, external request 0, provider attempt 0.

- [ ] **Step 2: 정적 검증**

```bash
"$TASK_NODE" node_modules/typescript/bin/tsc --noEmit
"$TASK_NODE" node_modules/eslint/bin/eslint.js src tests scripts middleware.ts next.config.ts
"$TASK_NODE" node_modules/next/dist/bin/next build --webpack
```

Expected: TypeScript error 0, ESLint error 0, build exit 0. 기존 경고는 별도 보고한다.

- [ ] **Step 3: 최종 범위 확인**

```bash
git status --short
git diff --check
git diff -- package.json scripts/run-notification-isolated-db-qa.mjs tests/notification-isolated-db-qa.test.mjs
```

Expected: 세 파일만 이 작업 범위이며 사용자 미추적 계획 문서는 제외된다.

- [ ] **Step 4: 정확한 파일만 커밋**

```bash
git add package.json scripts/run-notification-isolated-db-qa.mjs tests/notification-isolated-db-qa.test.mjs
git diff --cached --check
git commit -m "test: add isolated notification database QA"
```

- [ ] **Step 5: 다섯 증거 lane 보고 후 정지**

다음 항목을 분리 보고한다.

1. 코드 테스트·TypeScript·ESLint·Webpack
2. preview branch data-less preflight와 cleanup
3. 로컬 DB read-only·round-trip·pgTAP
4. provider-zero·runtime flags·cron/worker 0
5. Git commit·미추적 사용자 파일·push/deploy 0

Task 16은 자동으로 시작하지 않는다. DB lane이 모두 PASS여도 별도 사용자 승인 후 원래 계획 `docs/superpowers/plans/2026-08-03-self-contained-notification-content.md`의 Task 16을 한 태스크씩 실행한다.
