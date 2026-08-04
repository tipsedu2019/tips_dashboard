import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const parentProjectRef = "slnjqlzzhewblvttiidk"
const runnerUrl = new URL("../scripts/run-notification-isolated-db-qa.mjs", import.meta.url)
const repoRoot = fileURLToPath(new URL("..", import.meta.url))
const runnerSource = readFileSync(runnerUrl, "utf8")
const expectedPgTapFiles = Object.freeze([
  "supabase/tests/notification_control_plane_schema_test.sql",
  "supabase/tests/notification_content_contract_test.sql",
  "supabase/tests/notification_makeup_single_writer_test.sql",
  "supabase/tests/notification_control_plane_runtime_test.sql",
  "supabase/tests/notification_ops_task_adapters_test.sql",
  "supabase/tests/notification_registration_handoffs_test.sql",
  "supabase/tests/notification_transfer_withdrawal_adapters_test.sql",
  "supabase/tests/notification_makeup_adapter_test.sql",
  "supabase/tests/notification_approval_adapter_test.sql",
  "supabase/tests/notification_system_template_vnext_test.sql",
])
const localMigrations = Object.freeze([
  Object.freeze({
    fileName: "20260803140000_notification_content_contracts.sql",
    relativePath: "supabase/migrations/20260803140000_notification_content_contracts.sql",
    sha256: "a".repeat(64),
  }),
  Object.freeze({
    fileName: "20260803141000_notification_task_content_payload.sql",
    relativePath: "supabase/migrations/20260803141000_notification_task_content_payload.sql",
    sha256: "b".repeat(64),
  }),
  Object.freeze({
    fileName: "20260803142000_notification_word_retest_content_payload.sql",
    relativePath: "supabase/migrations/20260803142000_notification_word_retest_content_payload.sql",
    sha256: "c".repeat(64),
  }),
])
const remotePrefix = Object.freeze([
  Object.freeze({ version: "20260803140000", name: "notification_content_contracts" }),
  Object.freeze({ version: "20260803141000", name: "notification_task_content_payload" }),
])

const requiredRoles = Object.freeze([
  "anon",
  "authenticated",
  "authenticator",
  "postgres",
  "service_role",
  "supabase_admin",
])
const requiredSchemas = Object.freeze([
  "auth",
  "dashboard_private",
  "extensions",
  "public",
  "supabase_migrations",
])
const requiredCatalog = Object.freeze([
  "auth_users",
  "classes",
  "dashboard_notifications",
  "google_chat_webhook_settings",
  "migration_history",
  "notification_deliveries",
  "notification_rules",
  "notification_runtime_flags",
  "notification_settings_ui_registry",
  "notification_templates",
  "profiles",
  "students",
])

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function migrationIdentity(fileName) {
  const match = /^(\d{14})_([a-z0-9_]+)\.sql$/u.exec(fileName)
  assert.ok(match)
  return Object.freeze({ version: match[1], name: match[2] })
}

async function makeMigrationRepo(t, files) {
  const root = await mkdtemp(join(tmpdir(), "tips-notification-manifest-"))
  const migrationsDir = join(root, "supabase", "migrations")
  await mkdir(migrationsDir, { recursive: true, mode: 0o700 })
  for (const [fileName, contents] of Object.entries(files)) {
    await writeFile(join(migrationsDir, fileName), contents, { mode: 0o600 })
  }
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, migrationsDir }
}

async function makeArtifactRoot(t) {
  const root = await mkdtemp(join(tmpdir(), "tips-notification-collector-"))
  await chmod(root, 0o700)
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

async function writeLinkedProject(root, ref = parentProjectRef) {
  const linkedDir = join(root, "supabase", ".temp")
  await mkdir(linkedDir, { recursive: true, mode: 0o700 })
  await writeFile(
    join(linkedDir, "linked-project.json"),
    `${JSON.stringify({ ref, name: "TIPS QA" })}\n`,
    { mode: 0o600 },
  )
}

async function loadCollectorSubject(root) {
  const scriptsDir = join(root, "scripts")
  const copiedRunnerPath = join(scriptsDir, "run-notification-isolated-db-qa.mjs")
  await mkdir(scriptsDir, { recursive: true, mode: 0o700 })
  await writeFile(copiedRunnerPath, runnerSource, { mode: 0o600 })
  return import(pathToFileURL(copiedRunnerPath).href)
}

function remoteMetadataFixture(migrations = remotePrefix) {
  return {
    transaction_read_only: true,
    server_version_num: 170006,
    migrations,
    extensions: [
      { name: "pgcrypto", version: "1.3" },
      { name: "plpgsql", version: "1.0" },
      { name: "uuid-ossp", version: "1.1" },
    ],
    roles: Object.fromEntries(requiredRoles.map((name) => [name, true])),
    schemas: Object.fromEntries(requiredSchemas.map((name) => [name, true])),
    catalogs: Object.fromEntries(requiredCatalog.map((name) => [name, true])),
  }
}

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
    version: "20260803143000",
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
    name: "notification_word_retest_content_payload",
    fileName: "20260803142000_notification_word_retest_content_payload.sql",
    relativePath: "supabase/migrations/20260803142000_notification_word_retest_content_payload.sql",
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

test("pending manifest는 trusted root의 실제 파일 바이트로 SHA-256을 계산한다", async (t) => {
  const files = {
    "20260803140000_notification_content_contracts.sql": "select 'content';\n",
    "20260803141000_notification_task_content_payload.sql": "select 'task';\n",
    "20260803142000_notification_word_retest_content_payload.sql": "select 'word';\n",
  }
  const { root, migrationsDir } = await makeMigrationRepo(t, files)
  const { buildPendingMigrationManifest } = await loadSubject()

  const first = await buildPendingMigrationManifest(
    { migrations: remotePrefix },
    { repoRoot: root },
  )
  const second = await buildPendingMigrationManifest(
    { migrations: remotePrefix },
    { repoRoot: root },
  )

  assert.deepEqual(first, [{
    version: "20260803142000",
    name: "notification_word_retest_content_payload",
    fileName: "20260803142000_notification_word_retest_content_payload.sql",
    relativePath: "supabase/migrations/20260803142000_notification_word_retest_content_payload.sql",
    sha256: sha256(files["20260803142000_notification_word_retest_content_payload.sql"]),
  }])
  assert.deepEqual(second, first)
  assert.equal(Object.isFrozen(first), true)
  assert.equal(Object.isFrozen(first[0]), true)

  await writeFile(
    join(migrationsDir, "20260803142000_notification_word_retest_content_payload.sql"),
    "select 'word-changed';\n",
  )
  const changed = await buildPendingMigrationManifest(
    { migrations: remotePrefix },
    { repoRoot: root },
  )
  assert.notEqual(changed[0].sha256, first[0].sha256)
})

test("remote가 local 전체 exact prefix이면 pending manifest는 frozen empty다", async (t) => {
  const files = {
    "20260803140000_notification_content_contracts.sql": "select 1;\n",
    "20260803141000_notification_task_content_payload.sql": "select 2;\n",
  }
  const { root } = await makeMigrationRepo(t, files)
  const { buildPendingMigrationManifest } = await loadSubject()
  const migrations = Object.keys(files).sort().map(migrationIdentity)
  const pending = await buildPendingMigrationManifest({ migrations }, { repoRoot: root })

  assert.deepEqual(pending, [])
  assert.equal(Object.isFrozen(pending), true)
})

test("실제 파일 catalog에서도 remote drift를 fail-closed로 거부한다", async (t) => {
  const files = {
    "20260803140000_notification_content_contracts.sql": "select 1;\n",
    "20260803141000_notification_task_content_payload.sql": "select 2;\n",
    "20260803142000_notification_word_retest_content_payload.sql": "select 3;\n",
  }
  const { root } = await makeMigrationRepo(t, files)
  const { buildPendingMigrationManifest } = await loadSubject()
  const [first, second, third] = Object.keys(files).sort().map(migrationIdentity)
  const invalidRemoteHistories = [
    [],
    [first, first],
    [second, first],
    [first, third],
    [second, third],
    [{ version: first.version, name: "wrong_name" }],
    [{ version: "20260803139999", name: "remote_only" }],
  ]

  for (const migrations of invalidRemoteHistories) {
    await assert.rejects(
      () => buildPendingMigrationManifest({ migrations }, { repoRoot: root }),
      /notification_local_db_migration_drift/u,
    )
  }
})

test("symlink·비정규 migration entry와 중복 version을 거부한다", async (t) => {
  const { root, migrationsDir } = await makeMigrationRepo(t, {
    "20260803140000_notification_content_contracts.sql": "select 1;\n",
  })
  const outside = join(root, "outside.sql")
  await writeFile(outside, "select 'outside';\n", { mode: 0o600 })
  await symlink(outside, join(migrationsDir, "20260803141000_notification_task_content_payload.sql"))
  const { buildPendingMigrationManifest } = await loadSubject()

  await assert.rejects(
    () => buildPendingMigrationManifest(
      { migrations: [migrationIdentity("20260803140000_notification_content_contracts.sql")] },
      { repoRoot: root },
    ),
    /notification_local_db_migration_drift/u,
  )

  await rm(join(migrationsDir, "20260803141000_notification_task_content_payload.sql"))
  await writeFile(join(migrationsDir, "20260803140000_duplicate.sql"), "select 2;\n")
  await assert.rejects(
    () => buildPendingMigrationManifest(
      { migrations: [migrationIdentity("20260803140000_notification_content_contracts.sql")] },
      { repoRoot: root },
    ),
    /notification_local_db_migration_drift/u,
  )

  await rm(join(migrationsDir, "20260803140000_duplicate.sql"))
  await mkdir(join(migrationsDir, "20260803141000_directory.sql"))
  await assert.rejects(
    () => buildPendingMigrationManifest(
      { migrations: [migrationIdentity("20260803140000_notification_content_contracts.sql")] },
      { repoRoot: root },
    ),
    /notification_local_db_migration_drift/u,
  )
})

test("supabase parent directory symlink을 trusted migration root로 받아들이지 않는다", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "tips-notification-parent-link-"))
  const alternateSupabase = join(root, "alternate-supabase")
  const alternateMigrations = join(alternateSupabase, "migrations")
  await mkdir(alternateMigrations, { recursive: true, mode: 0o700 })
  await writeFile(
    join(alternateMigrations, "20260803140000_notification_content_contracts.sql"),
    "select 1;\n",
  )
  await symlink(alternateSupabase, join(root, "supabase"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const { buildPendingMigrationManifest } = await loadSubject()

  await assert.rejects(
    () => buildPendingMigrationManifest({
      migrations: [migrationIdentity("20260803140000_notification_content_contracts.sql")],
    }, { repoRoot: root }),
    /notification_local_db_migration_drift/u,
  )
})

test("현재 저장소 migration도 실제 마지막 파일 hash로 manifest를 만든다", async () => {
  const { buildPendingMigrationManifest } = await loadSubject()
  const migrationsDir = join(repoRoot, "supabase", "migrations")
  const fileNames = (await readdir(migrationsDir)).sort()
  assert.ok(fileNames.length > 1)
  const remote = fileNames.slice(0, -1).map(migrationIdentity)
  const lastFileName = fileNames.at(-1)
  const expectedBytes = await readFile(join(migrationsDir, lastFileName))

  const pending = await buildPendingMigrationManifest(
    { migrations: remote },
    { repoRoot },
  )

  assert.equal(pending.length, 1)
  assert.equal(pending[0].fileName, lastFileName)
  assert.equal(pending[0].sha256, sha256(expectedBytes))
})

test("remote collector는 metadata→schema dump→동일 metadata 순서만 실행한다", async (t) => {
  const files = {
    "20260803140000_notification_content_contracts.sql": "select 'content';\n",
    "20260803141000_notification_task_content_payload.sql": "select 'task';\n",
    "20260803142000_notification_word_retest_content_payload.sql": "select 'word';\n",
  }
  const { root } = await makeMigrationRepo(t, files)
  await writeLinkedProject(root)
  const artifactRoot = await makeArtifactRoot(t)
  const calls = []
  const metadataRows = JSON.stringify([{
    notification_local_qa_remote_metadata: remoteMetadataFixture(),
  }])
  const schemaSource = "-- schema-only fixture\ncreate schema if not exists dashboard_private;\n"
  const execute = async (invocation) => {
    calls.push(invocation)
    if (invocation.step === "schema-dump") {
      const fileIndex = invocation.args.indexOf("--file")
      await writeFile(invocation.args[fileIndex + 1], schemaSource)
      return { code: 0, stdout: "Dumped schema.\n", stderr: "" }
    }
    return { code: 0, stdout: metadataRows, stderr: "" }
  }
  const { collectRemoteSchemaMetadata } = await loadCollectorSubject(root)
  const canonicalRoot = await realpath(root)

  const result = await collectRemoteSchemaMetadata({
    approved: true,
    cliPath: "/opt/supabase",
    artifactRoot,
    linkedProjectMetadata: {
      project_ref: parentProjectRef,
      region: "ap-northeast-2",
      database_password: "must-not-survive",
    },
    sourceEnvironment: Object.assign(Object.create({ processEnvironmentLike: true }), {
      HOME: "/Users/qa",
      PATH: "/usr/bin:/bin",
      SUPABASE_ACCESS_TOKEN: "sbp_remote-access-secret",
      SUPABASE_DB_PASSWORD: "database-password-must-not-leak",
      GOOGLE_CHAT_WEBHOOK_URL: "https://chat.googleapis.com/v1/spaces/private/messages?key=secret",
    }),
  }, execute)

  assert.deepEqual(calls.map((call) => call.step), [
    "metadata-before",
    "schema-dump",
    "metadata-after",
  ])
  assert.deepEqual(calls[0].args, [
    "db", "query", "--linked",
    "--file", join(artifactRoot, "notification-remote-metadata.sql"),
    "--output", "json",
  ])
  assert.deepEqual(calls[1].args, [
    "db", "dump", "--linked",
    "--schema", "public,dashboard_private",
    "--file", join(artifactRoot, "notification-remote-schema.sql"),
  ])
  assert.deepEqual(calls[2].args, calls[0].args)
  assert.equal(calls.every((call) => call.command === "/opt/supabase"), true)
  assert.equal(calls.every((call) => call.cwd === canonicalRoot), true)
  assert.equal(calls.every((call) => Object.isFrozen(call) && Object.isFrozen(call.args)), true)
  assert.equal("SUPABASE_DB_PASSWORD" in calls[0].env, false)
  assert.equal(calls[1].env.SUPABASE_DB_PASSWORD, "database-password-must-not-leak")
  assert.equal("SUPABASE_DB_PASSWORD" in calls[2].env, false)
  assert.equal(calls.every((call) => !("GOOGLE_CHAT_WEBHOOK_URL" in call.env)), true)
  assert.equal(calls.every((call) => call.env.SUPABASE_ACCESS_TOKEN === "sbp_remote-access-secret"), true)
  assert.equal(calls.every((call) => Object.isFrozen(call.env)), true)
  assert.doesNotMatch(
    JSON.stringify(calls.map(({ command, args, cwd }) => ({ command, args, cwd }))),
    /database-password|remote-access-secret|chat\.googleapis/u,
  )

  const querySql = await readFile(join(artifactRoot, "notification-remote-metadata.sql"), "utf8")
  assert.match(querySql, /^begin read only;/u)
  assert.match(querySql, /current_setting\('transaction_read_only'\)/u)
  assert.match(querySql, /current_setting\('server_version_num'\)/u)
  assert.match(querySql, /supabase_migrations\.schema_migrations/u)
  assert.match(querySql, /pg_catalog\.pg_extension/u)
  assert.match(querySql, /pg_catalog\.pg_roles/u)
  assert.match(querySql, /pg_catalog\.to_regclass/u)
  assert.match(querySql, /rollback;\s*$/u)
  assert.doesNotMatch(querySql, /\b(?:insert|update|delete|truncate|alter|create|drop|copy)\b/iu)

  assert.equal(result.project.projectRef, parentProjectRef)
  assert.equal(result.remote.transactionReadOnly, true)
  assert.equal(result.remote.serverVersionNum, 170006)
  assert.equal(result.remote.postgresMajor, 17)
  assert.deepEqual(result.remote.migrations, remotePrefix)
  assert.equal(result.migrationManifest.pending.length, 1)
  assert.equal(
    result.migrationManifest.pending[0].sha256,
    sha256(files["20260803142000_notification_word_retest_content_payload.sql"]),
  )
  assert.deepEqual(result.safety, { rowDataCopied: 0, productionMutationCount: 0 })
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.remote), true)
  assert.equal(Object.isFrozen(result.migrationManifest.pending), true)
  assert.doesNotMatch(
    JSON.stringify(result),
    /must-not-survive|database-password|remote-access-secret|chat\.googleapis/u,
  )

  assert.deepEqual((await readdir(artifactRoot)).sort(), [
    "notification-remote-metadata.json",
    "notification-remote-metadata.sql",
    "notification-remote-schema.sql",
  ])
  for (const fileName of await readdir(artifactRoot)) {
    const fileStat = await lstat(join(artifactRoot, fileName))
    assert.equal(fileStat.isFile(), true)
    assert.equal(fileStat.mode & 0o777, 0o600)
  }
  assert.equal(await readFile(result.artifacts.schemaDumpPath, "utf8"), schemaSource)
  assert.deepEqual(JSON.parse(await readFile(result.artifacts.metadataPath, "utf8")), result.remote)
})

test("DB credential이 없으면 artifact와 child process 전에 닫힌다", async (t) => {
  const { root } = await makeMigrationRepo(t, {
    "20260803140000_notification_content_contracts.sql": "select 1;\n",
  })
  await writeLinkedProject(root)
  const artifactRoot = await makeArtifactRoot(t)
  let executeCallCount = 0
  const { collectRemoteSchemaMetadata } = await loadCollectorSubject(root)

  await assert.rejects(
    () => collectRemoteSchemaMetadata({
      approved: true,
      cliPath: "/opt/supabase",
      artifactRoot,
      linkedProjectMetadata: { project_ref: parentProjectRef, region: "ap-northeast-2" },
      sourceEnvironment: { SUPABASE_ACCESS_TOKEN: "sbp_not-enough" },
    }, async () => {
      executeCallCount += 1
      return { code: 0, stdout: "", stderr: "" }
    }),
    /notification_local_db_remote_credential_required/u,
  )
  assert.equal(executeCallCount, 0)
  assert.deepEqual(await readdir(artifactRoot), [])
})

test("collector는 caller가 repoRoot를 덮어쓰지 못하게 한다", async (t) => {
  const { root } = await makeMigrationRepo(t, {
    "20260803140000_notification_content_contracts.sql": "select 1;\n",
  })
  await writeLinkedProject(root)
  const artifactRoot = await makeArtifactRoot(t)
  const { collectRemoteSchemaMetadata } = await loadCollectorSubject(root)
  let executeCallCount = 0

  await assert.rejects(
    () => collectRemoteSchemaMetadata({
      approved: true,
      cliPath: "/opt/supabase",
      repoRoot: root,
      artifactRoot,
      linkedProjectMetadata: { project_ref: parentProjectRef, region: "ap-northeast-2" },
      sourceEnvironment: { SUPABASE_DB_PASSWORD: "qa-password" },
    }, async () => {
      executeCallCount += 1
      return { code: 0, stdout: "[]", stderr: "" }
    }),
    /notification_local_db_remote_context_refused/u,
  )
  assert.equal(executeCallCount, 0)
  assert.deepEqual(await readdir(artifactRoot), [])
})

test("artifact root는 비어 있는 exact 0700 directory만 허용한다", async (t) => {
  const { root } = await makeMigrationRepo(t, {
    "20260803140000_notification_content_contracts.sql": "select 1;\n",
  })
  await writeLinkedProject(root)
  const artifactRoot = await makeArtifactRoot(t)
  await chmod(artifactRoot, 0o500)
  let executeCallCount = 0
  const { collectRemoteSchemaMetadata } = await loadCollectorSubject(root)

  await assert.rejects(
    () => collectRemoteSchemaMetadata({
      approved: true,
      cliPath: "/opt/supabase",
      artifactRoot,
      linkedProjectMetadata: { project_ref: parentProjectRef, region: "ap-northeast-2" },
      sourceEnvironment: { SUPABASE_DB_PASSWORD: "qa-password" },
    }, async () => {
      executeCallCount += 1
      return { code: 0, stdout: "", stderr: "" }
    }),
    /notification_local_db_remote_artifact_refused/u,
  )
  assert.equal(executeCallCount, 0)
})

test("remote child 오류의 raw stderr를 버리고 exact artifact만 정리한다", async (t) => {
  const { root } = await makeMigrationRepo(t, {
    "20260803140000_notification_content_contracts.sql": "select 1;\n",
  })
  await writeLinkedProject(root)
  const artifactRoot = await makeArtifactRoot(t)
  const { collectRemoteSchemaMetadata } = await loadCollectorSubject(root)
  let caught
  try {
    await collectRemoteSchemaMetadata({
      approved: true,
      cliPath: "/opt/supabase",
      artifactRoot,
      linkedProjectMetadata: { project_ref: parentProjectRef, region: "ap-northeast-2" },
      sourceEnvironment: { SUPABASE_DB_PASSWORD: "bare-password-must-not-leak" },
    }, async () => ({
      code: 1,
      stdout: "postgresql://postgres:bare-password-must-not-leak@db.example.test/postgres",
      stderr: "sb_secret_must-not-leak https://chat.googleapis.com/v1/spaces/private/messages?key=secret",
    }))
  } catch (error) {
    caught = error
  }

  assert.match(String(caught), /notification_local_db_remote_metadata_query_failed/u)
  assert.doesNotMatch(String(caught), /must-not-leak|db\.example|chat\.googleapis/u)
  assert.deepEqual(await readdir(artifactRoot), [])
})

test("metadata query SQL이 child 실행 중 바뀌면 다음 remote call 전에 거부한다", async (t) => {
  const fileName = "20260803140000_notification_content_contracts.sql"
  const { root } = await makeMigrationRepo(t, { [fileName]: "select 1;\n" })
  await writeLinkedProject(root)
  const artifactRoot = await makeArtifactRoot(t)
  const { collectRemoteSchemaMetadata } = await loadCollectorSubject(root)
  let executeCallCount = 0

  await assert.rejects(
    () => collectRemoteSchemaMetadata({
      approved: true,
      cliPath: "/opt/supabase",
      artifactRoot,
      linkedProjectMetadata: { project_ref: parentProjectRef, region: "ap-northeast-2" },
      sourceEnvironment: { SUPABASE_DB_PASSWORD: "qa-password" },
    }, async (invocation) => {
      executeCallCount += 1
      const queryPath = invocation.args[invocation.args.indexOf("--file") + 1]
      await writeFile(queryPath, "delete from public.students;\n")
      return {
        code: 0,
        stdout: JSON.stringify([{
          notification_local_qa_remote_metadata: remoteMetadataFixture([
            migrationIdentity(fileName),
          ]),
        }]),
        stderr: "",
      }
    }),
    /notification_local_db_remote_query_contract_refused/u,
  )
  assert.equal(executeCallCount, 1)
  assert.deepEqual(await readdir(artifactRoot), [])
})

test("artifact cleanup 실패는 primary 오류와 함께 보존한다", async (t) => {
  const fileName = "20260803140000_notification_content_contracts.sql"
  const { root } = await makeMigrationRepo(t, { [fileName]: "select 1;\n" })
  await writeLinkedProject(root)
  const artifactRoot = await makeArtifactRoot(t)
  const { collectRemoteSchemaMetadata } = await loadCollectorSubject(root)
  let caught

  try {
    await collectRemoteSchemaMetadata({
      approved: true,
      cliPath: "/opt/supabase",
      artifactRoot,
      linkedProjectMetadata: { project_ref: parentProjectRef, region: "ap-northeast-2" },
      sourceEnvironment: { SUPABASE_DB_PASSWORD: "bare-password-must-not-leak" },
    }, async (invocation) => {
      const queryPath = invocation.args[invocation.args.indexOf("--file") + 1]
      await rm(queryPath)
      await mkdir(queryPath, { mode: 0o700 })
      return {
        code: 1,
        stdout: "",
        stderr: "bare-password-must-not-leak",
      }
    })
  } catch (error) {
    caught = error
  }

  assert.match(String(caught), /notification_local_db_remote_metadata_query_failed/u)
  assert.match(String(caught), /notification_local_db_remote_artifact_cleanup_failed/u)
  assert.doesNotMatch(String(caught), /bare-password-must-not-leak/u)
  assert.equal((await lstat(join(artifactRoot, "notification-remote-metadata.sql"))).isDirectory(), true)
})

test("metadata 전후 snapshot이 다르면 schema artifact를 폐기한다", async (t) => {
  const { root } = await makeMigrationRepo(t, {
    "20260803140000_notification_content_contracts.sql": "select 1;\n",
    "20260803141000_notification_task_content_payload.sql": "select 2;\n",
  })
  await writeLinkedProject(root)
  const artifactRoot = await makeArtifactRoot(t)
  const rows = [
    remoteMetadataFixture([migrationIdentity("20260803140000_notification_content_contracts.sql")]),
    remoteMetadataFixture([
      migrationIdentity("20260803140000_notification_content_contracts.sql"),
      migrationIdentity("20260803141000_notification_task_content_payload.sql"),
    ]),
  ]
  let metadataIndex = 0
  let executeCallCount = 0
  const { collectRemoteSchemaMetadata } = await loadCollectorSubject(root)

  await assert.rejects(
    () => collectRemoteSchemaMetadata({
      approved: true,
      cliPath: "/opt/supabase",
      artifactRoot,
      linkedProjectMetadata: { project_ref: parentProjectRef, region: "ap-northeast-2" },
      sourceEnvironment: { SUPABASE_DB_PASSWORD: "qa-password" },
    }, async (invocation) => {
      executeCallCount += 1
      if (invocation.step === "schema-dump") {
        await writeFile(invocation.args.at(-1), "create schema dashboard_private;\n")
        return { code: 0, stdout: "", stderr: "" }
      }
      const metadata = rows[metadataIndex]
      metadataIndex += 1
      return {
        code: 0,
        stdout: JSON.stringify([{ notification_local_qa_remote_metadata: metadata }]),
        stderr: "",
      }
    }),
    /notification_local_db_remote_snapshot_changed/u,
  )
  assert.equal(executeCallCount, 3)
  assert.deepEqual(await readdir(artifactRoot), [])
})

test("read-only metadata shape와 schema-only marker를 엄격히 검사한다", async (t) => {
  const { root } = await makeMigrationRepo(t, {
    "20260803140000_notification_content_contracts.sql": "select 1;\n",
  })
  await writeLinkedProject(root)
  const { collectRemoteSchemaMetadata } = await loadCollectorSubject(root)

  for (const scenario of ["not-read-only", "data-dump", "replaced-dump"]) {
    const artifactRoot = await makeArtifactRoot(t)
    let executeCallCount = 0
    await assert.rejects(
      () => collectRemoteSchemaMetadata({
        approved: true,
        cliPath: "/opt/supabase",
        artifactRoot,
        linkedProjectMetadata: { project_ref: parentProjectRef, region: "ap-northeast-2" },
        sourceEnvironment: { SUPABASE_DB_PASSWORD: "qa-password" },
      }, async (invocation) => {
        executeCallCount += 1
        if (invocation.step === "schema-dump") {
          const schemaPath = invocation.args.at(-1)
          if (scenario === "replaced-dump") await rm(schemaPath)
          await writeFile(
            schemaPath,
            scenario === "data-dump"
              ? "-- Data for Name: students\nCOPY public.students FROM stdin;\n"
              : "create schema dashboard_private;\n",
            { mode: 0o600 },
          )
          return { code: 0, stdout: "", stderr: "" }
        }
        const metadata = remoteMetadataFixture([
          migrationIdentity("20260803140000_notification_content_contracts.sql"),
        ])
        if (scenario === "not-read-only") metadata.transaction_read_only = false
        return {
          code: 0,
          stdout: JSON.stringify([{ notification_local_qa_remote_metadata: metadata }]),
          stderr: "",
        }
      }),
      scenario === "not-read-only"
        ? /notification_local_db_remote_metadata_invalid/u
        : /notification_local_db_remote_schema_dump_refused/u,
    )
    assert.equal(executeCallCount, scenario === "not-read-only" ? 1 : 2)
    assert.deepEqual(await readdir(artifactRoot), [])
  }
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
      syntheticFixture: {
        settingsRegistry: 185,
        rules: 186,
        operationalRows: 0,
      },
      pgTapFileCount: 10,
      pgTapFiles: expectedPgTapFiles,
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
