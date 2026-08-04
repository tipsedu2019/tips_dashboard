import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import test from "node:test"

const parentProjectRef = "slnjqlzzhewblvttiidk"
const runnerUrl = new URL("../scripts/run-notification-isolated-db-qa.mjs", import.meta.url)
const runnerSource = readFileSync(runnerUrl, "utf8")
const localMigrations = Object.freeze([
  Object.freeze({
    fileName: "20260803140000_notification_content_contracts.sql",
    relativePath: "supabase/migrations/20260803140000_notification_content_contracts.sql",
    sha256: "a".repeat(64),
  }),
  Object.freeze({
    fileName: "20260803141000_notification_tasks_word_retest_content.sql",
    relativePath: "supabase/migrations/20260803141000_notification_tasks_word_retest_content.sql",
    sha256: "b".repeat(64),
  }),
  Object.freeze({
    fileName: "20260803142000_notification_registration_content_payload.sql",
    relativePath: "supabase/migrations/20260803142000_notification_registration_content_payload.sql",
    sha256: "c".repeat(64),
  }),
])
const remotePrefix = Object.freeze([
  Object.freeze({ version: "20260803140000", name: "notification_content_contracts" }),
  Object.freeze({ version: "20260803141000", name: "notification_tasks_word_retest_content" }),
])

async function loadSubject() {
  return import(runnerUrl.href)
}

test("linked project metadata는 production ref와 허용 region만 보존한다", async () => {
  const { assertLinkedProjectMetadata } = await loadSubject()
  const metadata = assertLinkedProjectMetadata({
    project_ref: parentProjectRef,
    region: "ap-northeast-2",
    database_password: "must-not-survive",
    postgres_url: "postgresql://postgres:must-not-survive@example.test/postgres",
  })

  assert.deepEqual(metadata, {
    projectRef: parentProjectRef,
    region: "ap-northeast-2",
  })
  assert.equal(Object.isFrozen(metadata), true)
  assert.doesNotMatch(JSON.stringify(metadata), /must-not-survive/u)
})

for (const value of [
  null,
  { project_ref: "abcdefghijklmnopqrst", region: "ap-northeast-2" },
  { project_ref: parentProjectRef, region: "us-east-1" },
  { project_ref: parentProjectRef },
]) {
  test(`허용되지 않은 linked metadata를 거부한다: ${JSON.stringify(value)}`, async () => {
    const { assertLinkedProjectMetadata } = await loadSubject()
    assert.throws(
      () => assertLinkedProjectMetadata(value),
      /notification_local_db_project_metadata_refused/u,
    )
  })
}

test("remote migration은 repository-known prefix로만 정규화한다", async () => {
  const { normalizeRemoteMigrationVersions } = await loadSubject()
  const migrations = normalizeRemoteMigrationVersions({ migrations: remotePrefix }, localMigrations)

  assert.deepEqual(migrations, remotePrefix)
  assert.equal(Object.isFrozen(migrations), true)
  assert.equal(migrations.every((migration) => Object.isFrozen(migration)), true)
})

for (const payload of [
  { migrations: [] },
  { migrations: [{ version: "2026080314000", name: "notification_content_contracts" }] },
  { migrations: [remotePrefix[0], remotePrefix[0]] },
  { migrations: [remotePrefix[1], remotePrefix[0]] },
  { migrations: [remotePrefix[0], {
    version: "20260803142000",
    name: "notification_registration_content_payload",
  }] },
  { migrations: [{ version: "20260803139999", name: "remote_only" }] },
  { migrations: Object.assign(new Array(2), { 0: remotePrefix[0] }) },
  { migrations: "not-an-array" },
]) {
  test(`remote migration drift를 거부한다: ${JSON.stringify(payload)}`, async () => {
    const { normalizeRemoteMigrationVersions } = await loadSubject()
    assert.throws(
      () => normalizeRemoteMigrationVersions(payload, localMigrations),
      /notification_local_db_migration_drift/u,
    )
  })
}

test("pending migration은 remote max보다 새로운 exact path와 SHA-256만 반환한다", async () => {
  const { derivePendingMigrationFiles } = await loadSubject()
  const pending = derivePendingMigrationFiles(remotePrefix, localMigrations)

  assert.deepEqual(pending, [{
    version: "20260803142000",
    name: "notification_registration_content_payload",
    fileName: "20260803142000_notification_registration_content_payload.sql",
    relativePath: "supabase/migrations/20260803142000_notification_registration_content_payload.sql",
    sha256: "c".repeat(64),
  }])
  assert.equal(Object.isFrozen(pending), true)
  assert.equal(Object.isFrozen(pending[0]), true)
})

test("pending migration descriptor가 안전하지 않으면 거부한다", async () => {
  const { derivePendingMigrationFiles } = await loadSubject()
  const unsafe = localMigrations.map((migration) => ({ ...migration }))
  unsafe[2].relativePath = "../outside.sql"

  assert.throws(
    () => derivePendingMigrationFiles(remotePrefix, unsafe),
    /notification_local_db_migration_drift/u,
  )
})

for (const target of [
  "postgresql://postgres:postgres@127.0.0.1:55432/postgres",
  "postgres://postgres:postgres@localhost:55432/postgres",
  "postgresql://postgres:postgres@[::1]:55432/postgres",
]) {
  test(`exact loopback mutation target만 허용한다: ${target}`, async () => {
    const { assertLocalMutationTarget } = await loadSubject()
    const safe = assertLocalMutationTarget(target, 55432)
    assert.deepEqual(safe, { hostname: safe.hostname, port: 55432, database: "postgres" })
    assert.equal(["127.0.0.1", "localhost", "::1"].includes(safe.hostname), true)
    assert.equal(Object.isFrozen(safe), true)
  })
}

for (const target of [
  `postgresql://postgres:postgres@db.${parentProjectRef}.supabase.co:5432/postgres`,
  "postgresql://postgres:postgres@host.docker.internal:55432/postgres",
  "postgresql://postgres:postgres@127.0.0.1:55433/postgres",
  "postgresql://postgres:top-secret@127.0.0.1:55432/postgres",
  "postgresql://postgres:postgres@127.0.0.1:55432/other",
  "https://127.0.0.1:55432/postgres",
]) {
  test(`unsafe local mutation target을 거부한다: ${target}`, async () => {
    const { assertLocalMutationTarget } = await loadSubject()
    assert.throws(
      () => assertLocalMutationTarget(target, 55432),
      /notification_local_db_mutation_target_refused/u,
    )
  })
}

test("명령 증거에서 DB 자격 증명과 공급자 비밀을 가린다", async () => {
  const { redactCommandEvidence } = await loadSubject()
  const evidence = redactCommandEvidence([
    "postgresql://postgres:top-secret@db.example.test:5432/postgres?sslmode=require",
    "sbp_supersecret123",
    "sb_secret_new-secret_key",
    "sb_publishable_public-looking_key",
    "https://chat.googleapis.com/v1/spaces/example/messages?key=abc&token=def",
  ].join(" "))

  assert.doesNotMatch(
    evidence,
    /top-secret|db\.example\.test|sslmode=require|supersecret|new-secret|public-looking|spaces\/example|key=abc|token=def/u,
  )
  assert.match(evidence, /\[redacted-postgres-url\]/u)
  assert.match(evidence, /\[redacted-supabase-key\]/u)
  assert.match(evidence, /\[redacted-google-chat-webhook\]/u)
})

test("승인되지 않은 실행과 승인된 미구현 실행 모두 child process 전에 닫힌다", async () => {
  const { runNotificationIsolatedDbQa } = await loadSubject()
  let executeCallCount = 0
  const execute = async () => {
    executeCallCount += 1
    return { code: 0, stdout: "", stderr: "" }
  }

  await assert.rejects(
    () => runNotificationIsolatedDbQa({ approved: false, execute }),
    /notification_local_db_approval_required/u,
  )
  await assert.rejects(
    () => runNotificationIsolatedDbQa({ approved: true, execute }),
    /notification_local_db_runner_not_implemented/u,
  )
  assert.equal(executeCallCount, 0)
})

test("CLI 기본 모드는 무료 티어 계획만 출력하고 자원을 만들지 않는다", () => {
  const result = spawnSync(process.execPath, [runnerUrl.pathname], {
    encoding: "utf8",
    env: {
      ...process.env,
      SUPABASE_ACCESS_TOKEN: "sbp_must_not_leak",
      SUPABASE_DB_PASSWORD: "database-password-must-not-leak",
      GOOGLE_CHAT_WEBHOOK_URL: "https://chat.googleapis.com/v1/spaces/example/messages?key=must-not-leak",
    },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /must-not-leak/u)
  assert.deepEqual(JSON.parse(result.stdout), {
    mode: "plan",
    approved: false,
    requiredFlags: ["--execute", "--approved-local-db"],
    expectedResources: {
      previewBranches: 0,
      productionRowDataCopied: 0,
      productionMutationCount: 0,
      localDatabaseProjectPattern: "tips_notification_db_qa_<random>",
      localDatabasePort: "dynamic-loopback",
      internalDockerNetwork: true,
      pgTapFileCount: 10,
      providerEgressBlocked: true,
    },
  })
})

for (const args of [
  ["--execute"],
  ["--approved-local-db"],
  ["--execute", "--approved-preview-branch"],
]) {
  test(`불완전하거나 기존 CLI 승인 플래그는 거부한다: ${args.join(" ")}`, () => {
    const result = spawnSync(process.execPath, [runnerUrl.pathname, ...args], {
      encoding: "utf8",
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /notification_local_db_approval_required/u)
  })
}

test("새 full flag도 구현 전에는 외부 명령 없이 닫힌다", () => {
  const result = spawnSync(process.execPath, [
    runnerUrl.pathname,
    "--execute",
    "--approved-local-db",
  ], { encoding: "utf8" })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /notification_local_db_runner_not_implemented/u)
})

test("runner source에는 Preview Branch command가 남지 않는다", () => {
  assert.doesNotMatch(
    runnerSource,
    /["']branches["']\s*,\s*["'](?:list|create|get|delete)["']/u,
  )
})
