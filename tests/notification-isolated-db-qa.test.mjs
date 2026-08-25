import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const parentProjectRef = "slnjqlzzhewblvttiidk"
const expectedSupabaseGoCliPath =
  "/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go"
const runnerUrl = new URL("../scripts/run-notification-isolated-db-qa.mjs", import.meta.url)
const repoRoot = fileURLToPath(new URL("..", import.meta.url))
const runnerSource = readFileSync(runnerUrl, "utf8")
const expectedPgTapFiles = Object.freeze([
  "supabase/tests/notification_control_plane_schema_test.sql",
  "supabase/tests/notification_adapters_forward_install_test.sql",
  "supabase/tests/notification_content_contract_test.sql",
  "supabase/tests/notification_delivery_pending_schedule_test.sql",
  "supabase/tests/notification_makeup_single_writer_test.sql",
  "supabase/tests/notification_control_plane_runtime_test.sql",
  "supabase/tests/notification_ops_task_adapters_test.sql",
  "supabase/tests/notification_registration_handoffs_test.sql",
  "supabase/tests/notification_transfer_withdrawal_adapters_test.sql",
  "supabase/tests/notification_makeup_adapter_test.sql",
  "supabase/tests/notification_approval_adapter_test.sql",
  "supabase/tests/notification_system_template_vnext_test.sql",
  "supabase/tests/notification_worker_production_schedule_test.sql",
  "supabase/tests/notification_contract_drain_evidence_schema_repair_test.sql",
])
const exactLocalOrchestrationSteps = Object.freeze([
  "preexisting-resource-check",
  "internal-network-create",
  "local-db-start",
  "public-default-privileges",
  "schema-restore",
  "local-catalog-postflight",
  "remote-migration-repair",
  "pending-migrations-copy",
  "runtime-activation-scan",
  "local-migration-push",
  "synthetic-fixture-install",
  "safety-preflight",
  "read-only-evidence",
  "disposable-round-trip",
  "pgtap",
  "safety-postflight",
  "cleanup",
])
const expectedFixtureCounts = Object.freeze({
  authUsers: 1,
  profiles: 1,
  workflows: 7,
  eventKeys: 58,
  settingsRegistry: 196,
  rules: 197,
  historicalTemplates: 197,
  vNextTemplates: 196,
  templates: 393,
  contentContracts: 196,
  complianceAudits: 196,
  legacySettings: 42,
  importMetadata: 42,
  runtimeFlags: 12,
  reminderApplicability: 4,
  operationalRows: 0,
})
const injectedRandomBytes = Buffer.from("a1b2c3d4e5f6", "hex")
const expectedRuntimeProjectId = "tips_notification_db_qa_a1b2c3d4e5f6"
const expectedOwnershipLabelKey = "com.tips.notification-local-db-qa.owner"
const expectedDockerNetworkId = "9".repeat(64)
const pendingMigrationFixture = Object.freeze({
  version: "20260803142000",
  name: "notification_word_retest_content_payload",
  fileName: "20260803142000_notification_word_retest_content_payload.sql",
  relativePath:
    "supabase/migrations/20260803142000_notification_word_retest_content_payload.sql",
  sha256: "c".repeat(64),
})
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
const migrationCatalogFixture = Object.freeze(localMigrations.map((entry) => {
  const match = /^(\d{14})_([a-z0-9_]+)\.sql$/u.exec(entry.fileName)
  return Object.freeze({
    version: match[1],
    name: match[2],
    fileName: entry.fileName,
    relativePath: entry.relativePath,
    sha256: entry.sha256,
  })
}))
const remotePrefix = Object.freeze([
  Object.freeze({ version: "20260803140000", name: "notification_content_contracts" }),
  Object.freeze({ version: "20260803141000", name: "notification_task_content_payload" }),
])
const expectedRemotePoolerRoute = Object.freeze({
  mode: "shared-supavisor-session",
  projectRef: "slnjqlzzhewblvttiidk",
  region: "ap-northeast-2",
  host: "aws-1-ap-northeast-2.pooler.supabase.com",
  port: 5432,
  user: "postgres.slnjqlzzhewblvttiidk",
  database: "postgres",
  sslmode: "verify-full",
  sslrootcert: "/qa/prod-ca-2021.crt",
})
const expectedRemoteClientImage = Object.freeze({
  tag: "public.ecr.aws/supabase/postgres:17.6.1.132",
  digest: "sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13",
  reference:
    "public.ecr.aws/supabase/postgres:17.6.1.132@sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13",
  major: 17,
})
const expectedRemoteTlsCa = Object.freeze({
  sha256: "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7",
  fingerprint256:
    "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA",
  notAfter: "2031-04-26T10:56:53.000Z",
})

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
  const certificatePath = join(root, "supabase", "certs", "prod-ca-2021.crt")
  await mkdir(migrationsDir, { recursive: true, mode: 0o700 })
  await mkdir(join(root, "supabase", "certs"), { recursive: true, mode: 0o700 })
  await copyFile(join(repoRoot, "supabase", "certs", "prod-ca-2021.crt"), certificatePath)
  await chmod(certificatePath, 0o644)
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

function fixtureContractFixture() {
  return {
    manifest: {
      version: 1,
      sqlSha256: "d".repeat(64),
      expectedCounts: { ...expectedFixtureCounts },
      identities: {
        namespace: "notification-content-local-qa-v1",
        roundTrip: {
          workflowKey: "tasks",
          eventKey: "task.created",
          audienceKey: "requester_profile",
          channelKey: "in_app",
          ruleVariantKey: "immediate",
          ruleId: "08c5fd0c-36bb-5798-869a-1f9ff46a902a",
          activeTemplateId: "222914cb-f640-55b9-862c-0343f547480d",
        },
      },
    },
    fixture: {
      relativePath: "supabase/tests/fixtures/notification_content_local_qa_fixture.sql",
      sha256: "d".repeat(64),
    },
    pgTap: {
      fileCount: 14,
      sha256: "e".repeat(64),
      files: expectedPgTapFiles.map((relativePath, index) => ({
        relativePath,
        sha256: index.toString(16).padStart(64, "0"),
      })),
    },
  }
}

async function loadRepositoryMigrationCatalog() {
  const migrationDirectory = join(repoRoot, "supabase", "migrations")
  const migrationFileNames = (await readdir(migrationDirectory))
    .filter((fileName) => /^(\d{14})_([a-z0-9_]+)\.sql$/u.test(fileName))
    .sort()
  const migrationCatalog = []
  for (const fileName of migrationFileNames) {
    const match = /^(\d{14})_([a-z0-9_]+)\.sql$/u.exec(fileName)
    migrationCatalog.push({
      version: match[1],
      name: match[2],
      fileName,
      relativePath: `supabase/migrations/${fileName}`,
      sha256: sha256(await readFile(join(migrationDirectory, fileName))),
    })
  }
  return migrationCatalog
}

async function buildRuntimeManifest(t) {
  const tempRoot = await mkdtemp(join(tmpdir(), "tips-notification-runtime-"))
  await chmod(tempRoot, 0o700)
  t.after(() => rm(tempRoot, { recursive: true, force: true }))
  const randomCalls = []
  const portCalls = []
  const { buildNotificationLocalRuntimeManifest } = await loadSubject()
  const manifest = await buildNotificationLocalRuntimeManifest({
    randomBytes: (size) => {
      randomCalls.push(size)
      return Buffer.from(injectedRandomBytes)
    },
    allocateLoopbackPort: async (host) => {
      portCalls.push(host)
      return 55432
    },
    tempRoot,
    migrationCatalog: migrationCatalogFixture,
    pendingMigrations: [{ ...pendingMigrationFixture }],
    fixtureContract: fixtureContractFixture(),
  })
  return { manifest, portCalls, randomCalls, tempRoot }
}

function remoteCollectionFixture(manifest) {
  const migrationManifestCore = {
    version: 2,
    applied: remotePrefix,
    catalog: manifest.migrationCatalog,
    pending: manifest.pendingMigrations,
  }
  return {
    project: {
      projectRef: parentProjectRef,
      region: "ap-northeast-2",
    },
    remote: {
      transactionReadOnly: true,
      serverVersionNum: 170006,
      postgresMajor: 17,
      migrations: remotePrefix,
    },
    migrationManifest: {
      ...migrationManifestCore,
      sha256: sha256(JSON.stringify(migrationManifestCore)),
    },
    artifacts: {
      schemaDumpPath: join(manifest.tempRoot, "notification-remote-schema.sql"),
      schemaDumpSha256: "1".repeat(64),
    },
    safety: {
      rowDataCopied: 0,
      productionMutationCount: 0,
    },
  }
}

function sourceEnvironmentFixture() {
  return {
    HOME: "/Users/qa",
    LANG: "ko_KR.UTF-8",
    LC_ALL: "C",
    PATH: "/usr/bin:/bin",
    TMPDIR: "/private/tmp",
    SUPABASE_ACCESS_TOKEN: "sbp_remote-access-secret",
    SUPABASE_DB_PASSWORD: "remote-database-secret",
    GOOGLE_CHAT_WEBHOOK_URL:
      "https://chat.googleapis.com/v1/spaces/private/messages?key=provider-secret",
    GOOGLE_CHAT_SERVICE_ACCOUNT_JSON: "provider-service-account-secret",
    SLACK_WEBHOOK_URL: "https://hooks.slack.test/provider-secret",
    RESEND_API_KEY: "provider-email-secret",
    TWILIO_AUTH_TOKEN: "provider-sms-secret",
  }
}

function successfulStepEvidence(step, manifest) {
  switch (step) {
    case "preexisting-resource-check":
      return { dockerServerMajor: 28, ownedResourceCount: 0, resources: [] }
    case "internal-network-create":
      return {
        networkId: expectedDockerNetworkId,
        networkName: manifest.dockerNetwork.name,
        driver: "bridge",
        hostBindingIpv4: "127.0.0.1",
        internal: true,
      }
    case "local-db-start":
      return {
        projectId: manifest.projectId,
        databaseHost: "127.0.0.1",
        databasePort: 55432,
        ownedResourceCount: 3,
        serviceContainersRemaining: 0,
        started: true,
      }
    case "public-default-privileges":
      return { publicDefaultPrivilegesRevoked: true }
    case "schema-restore":
      return { restored: true, rowDataCopied: 0, schemaSha256: "1".repeat(64) }
    case "local-catalog-postflight":
      return { ownerGrantRlsExtensionChecksPassed: true }
    case "remote-migration-repair":
      return {
        stagedCatalog: manifest.migrationCatalog.map(({ fileName }) => fileName),
        repairedVersions: remotePrefix.map(({ version }) => version),
      }
    case "pending-migrations-copy":
      return {
        migrationCatalog: manifest.migrationCatalog,
        pendingMigrations: manifest.pendingMigrations,
      }
    case "runtime-activation-scan":
      return { unsafeActivationCount: 0 }
    case "local-migration-push":
      return {
        dryRunPassed: true,
        appliedPendingVersions: manifest.pendingMigrations.map(({ version }) => version),
      }
    case "synthetic-fixture-install":
      return { fixtureSqlSha256: "d".repeat(64), counts: expectedFixtureCounts }
    case "safety-preflight":
    case "safety-postflight":
      return {
        egressBlocked: true,
        workerProcesses: 0,
        queueRows: 0,
        enabledDispatchFlags: 0,
      }
    case "read-only-evidence":
      return {
        mode: "read-only",
        settingsRegistry: 196,
        rules: 197,
        templates: 393,
        contentContracts: 196,
        operationalRows: 0,
      }
    case "disposable-round-trip":
      return {
        mode: "round-trip",
        mutationTarget: "loopback",
        restored: true,
        residualRows: 0,
        enabledDispatchFlags: 0,
      }
    case "pgtap":
      return {
        fileCount: 14,
        passed: 14,
        failed: 0,
        files: expectedPgTapFiles,
      }
    case "cleanup":
      return {
        ownedResourcesRemaining: 0,
        containersRemaining: 0,
        volumesRemaining: 0,
        networksRemaining: 0,
      }
    default:
      assert.fail(`unexpected fake step: ${step}`)
  }
}

function actualEvidenceModuleQueryResult(step) {
  if (step === "read-only-evidence") {
    return {
      mode: "read-only",
      runtimeFlagsAllFalseBefore: true,
      runtimeFlagsAllFalseAfter: true,
      connectionValues: "[redacted]",
      connectionCount: 0,
      operationalDeltas: {
        pendingClaimedSending: 0,
        inbox: 0,
        providerAttempts: 0,
        audit: 0,
      },
    }
  }
  if (step === "disposable-round-trip") {
    return {
      mode: "round-trip",
      runtimeFlagsAllFalseBefore: true,
      runtimeFlagsAllFalseAfter: true,
      rolledBack: true,
      conflictCode: "notification_revision_conflict",
      conflictPreserved: true,
      noOpPreserved: true,
      titleTemplate: "🌿 [업무 알림] {task_title} 내용을 함께 확인해요",
      bodyTemplate: [
        "[담당] {current_assignee}",
        "[업무] {task_title}",
        "[상태] {current_status}",
        "[안내] 필요한 내용을 한눈에 볼 수 있어요.",
      ].join("\n"),
      renderContext: {
        task_title: "2학기 수학 교재 주문",
        current_assignee: "김철수님",
        current_status: "요청됐어요.",
      },
      expectedTitle: "🌿 [업무 알림] 2학기 수학 교재 주문 내용을 함께 확인해요",
      expectedBody: [
        "[담당] 김철수님",
        "[업무] 2학기 수학 교재 주문",
        "[상태] 요청됐어요.",
        "[안내] 필요한 내용을 한눈에 볼 수 있어요.",
      ].join("\n"),
      fixtureWrites: { ruleRevisionDelta: 1, templateDelta: 1, auditDelta: 1 },
      operationalDeltas: { pendingClaimedSending: 0, inbox: 0, providerAttempts: 0 },
    }
  }
  assert.fail(`unexpected evidence step: ${step}`)
}

function makeFakeExecutor(manifest, calls, { failStep, cleanupFails = false } = {}) {
  return async (invocation) => {
    calls.push(invocation)
    if (invocation.step === "local-db-start") {
      assert.equal(invocation.state.localStartAttempted, true)
    }
    if (invocation.step === "cleanup" && cleanupFails) {
      return {
        code: 19,
        stdout: "postgresql://postgres:cleanup-secret@127.0.0.1:55432/postgres",
        stderr: "sbp_cleanup-secret",
      }
    }
    if (invocation.step === failStep) {
      return {
        code: 17,
        stdout: "postgresql://postgres:primary-secret@127.0.0.1:55432/postgres",
        stderr:
          "https://chat.googleapis.com/v1/spaces/private/messages?key=provider-secret",
      }
    }
    return {
      code: 0,
      stdout: "",
      stderr: "",
      evidence: successfulStepEvidence(invocation.step, manifest),
    }
  }
}

function controlledEvidenceRunner(calls) {
  return async ({ databaseUrl, disposable, query }) => {
    assert.equal(
      databaseUrl,
      "postgresql://postgres:postgres@127.0.0.1:55432/postgres",
    )
    assert.equal(typeof query, "function")
    calls.push({ databaseUrl, disposable, query })
    return query({
      databaseUrl,
      sql: disposable === true
        ? "select 'controlled-disposable-round-trip';"
        : "select 'controlled-read-only-evidence';",
    })
  }
}

function orchestrationContext(manifest, execute, { evidenceCalls = [] } = {}) {
  return {
    approved: true,
    runtimeManifest: manifest,
    remoteCollection: remoteCollectionFixture(manifest),
    fixtureContract: fixtureContractFixture(),
    sourceEnvironment: sourceEnvironmentFixture(),
    execute,
    runEvidence: controlledEvidenceRunner(evidenceCalls),
  }
}

test("고정 Session Pooler route와 client image 이외의 remote 연결 입력을 거부한다", async () => {
  const {
    assertNotificationRemoteClientImage,
    assertNotificationRemoteClientVersion,
    assertNotificationRemotePoolerRoute,
  } = await loadSubject()

  assert.deepEqual(
    assertNotificationRemotePoolerRoute(expectedRemotePoolerRoute),
    expectedRemotePoolerRoute,
  )
  assert.deepEqual(
    assertNotificationRemoteClientImage(expectedRemoteClientImage),
    expectedRemoteClientImage,
  )
  assert.equal(Object.isFrozen(assertNotificationRemotePoolerRoute(expectedRemotePoolerRoute)), true)
  assert.equal(Object.isFrozen(assertNotificationRemoteClientImage(expectedRemoteClientImage)), true)
  assert.equal(
    assertNotificationRemoteClientVersion("psql (PostgreSQL) 17.6\n", "psql"),
    17,
  )
  assert.equal(
    assertNotificationRemoteClientVersion("pg_dump (PostgreSQL) 17.6\n", "pg_dump"),
    17,
  )

  for (const [name, value] of [
    ["other mode", { ...expectedRemotePoolerRoute, mode: "direct" }],
    ["other project ref", { ...expectedRemotePoolerRoute, projectRef: "abcdefghijklmnopqrst" }],
    ["direct host", { ...expectedRemotePoolerRoute, host: "db.slnjqlzzhewblvttiidk.supabase.co" }],
    ["other region", { ...expectedRemotePoolerRoute, region: "ap-southeast-1" }],
    ["transaction port", { ...expectedRemotePoolerRoute, port: 6543 }],
    ["other user", { ...expectedRemotePoolerRoute, user: "postgres" }],
    ["other database", { ...expectedRemotePoolerRoute, database: "template1" }],
    ["weaker TLS", { ...expectedRemotePoolerRoute, sslmode: "require" }],
    ["missing CA mount", { ...expectedRemotePoolerRoute, sslrootcert: "" }],
    ["control character", { ...expectedRemotePoolerRoute, host: "aws-1-ap-northeast-2.pooler.supabase.com\n" }],
    ["extra key", { ...expectedRemotePoolerRoute, unsafeOverride: true }],
  ]) {
    assert.throws(
      () => assertNotificationRemotePoolerRoute(value),
      /notification_local_db_remote_pooler_route_refused/u,
      name,
    )
  }

  for (const [name, value] of [
    ["tag-only reference", { ...expectedRemoteClientImage, reference: expectedRemoteClientImage.tag }],
    ["digest drift", { ...expectedRemoteClientImage, digest: `sha256:${"0".repeat(64)}` }],
    ["major drift", { ...expectedRemoteClientImage, major: 16 }],
    ["extra key", { ...expectedRemoteClientImage, mutable: true }],
  ]) {
    assert.throws(
      () => assertNotificationRemoteClientImage(value),
      /notification_local_db_remote_client_image_refused/u,
      name,
    )
  }

  for (const [stdout, executable] of [
    ["psql (PostgreSQL) 16.9", "psql"],
    ["pg_dump (PostgreSQL) 16.9", "pg_dump"],
    ["psql (PostgreSQL) 17.6", "postgres"],
    ["unexpected client output", "psql"],
  ]) {
    assert.throws(
      () => assertNotificationRemoteClientVersion(stdout, executable),
      /notification_local_db_remote_client_version_refused/u,
    )
  }
})

test("Supabase 공개 CA의 file identity와 certificate identity를 함께 검증한다", async (t) => {
  const { inspectNotificationRemoteTlsCa } = await loadSubject()
  const expectedPath = join(repoRoot, "supabase", "certs", "prod-ca-2021.crt")
  const evidence = await inspectNotificationRemoteTlsCa({
    repoRoot,
    now: Date.parse("2026-08-04T00:00:00Z"),
  })

  assert.deepEqual(evidence, { path: expectedPath, ...expectedRemoteTlsCa })
  await assert.rejects(
    () => inspectNotificationRemoteTlsCa({
      repoRoot,
      now: Date.parse("2031-04-26T10:56:54Z"),
    }),
    /notification_local_db_remote_tls_ca_refused/u,
  )

  const tamperedRoot = await mkdtemp(join(tmpdir(), "tips-notification-ca-"))
  const tamperedCaPath = join(tamperedRoot, "supabase", "certs", "prod-ca-2021.crt")
  t.after(() => rm(tamperedRoot, { recursive: true, force: true }))
  await mkdir(join(tamperedRoot, "supabase", "certs"), { recursive: true, mode: 0o700 })
  await copyFile(expectedPath, tamperedCaPath)
  await chmod(tamperedCaPath, 0o644)
  await writeFile(tamperedCaPath, "tampered certificate\n", { mode: 0o644 })
  await assert.rejects(
    () => inspectNotificationRemoteTlsCa({ repoRoot: tamperedRoot }),
    /notification_local_db_remote_tls_ca_refused/u,
  )

  await rm(tamperedCaPath)
  await symlink(expectedPath, tamperedCaPath)
  await assert.rejects(
    () => inspectNotificationRemoteTlsCa({ repoRoot: tamperedRoot }),
    /notification_local_db_remote_tls_ca_refused/u,
  )
})

test("remote collector runtime은 numeric caller UID/GID 없이는 workdir를 만들지 않는다", async (t) => {
  const artifactRoot = await makeArtifactRoot(t)
  const { buildNotificationRemoteCollectorRuntime } = await loadSubject()

  for (const [getUid, getGid] of [
    [() => undefined, () => 20],
    [() => -1, () => 20],
    [() => 501.5, () => 20],
    [() => 501, () => undefined],
    [() => 501, () => -1],
    [() => 501, () => 20.5],
  ]) {
    await assert.rejects(
      () => buildNotificationRemoteCollectorRuntime({
        tempRoot: artifactRoot,
        randomBytes: () => Buffer.from("a0b1c2d3e4f5", "hex"),
        getUid,
        getGid,
      }),
      /notification_local_db_remote_runtime_refused/u,
    )
  }
  assert.deepEqual(await readdir(artifactRoot), [])
})

async function remoteDockerRuntimeFixture(t) {
  const artifactRoot = await makeArtifactRoot(t)
  const projectId = "tips_notify_collector_qa_a0b1c2d3e4f5"
  return {
    artifactRoot,
    runtime: {
      version: 2,
      projectId,
      tempRoot: artifactRoot,
      workdir: join(artifactRoot, "remote-collector"),
      uid: 501,
      gid: 20,
      label: { key: "com.supabase.cli.project", value: projectId },
      route: expectedRemotePoolerRoute,
      client: expectedRemoteClientImage,
      files: {
        caPath: join(repoRoot, "supabase", "certs", "prod-ca-2021.crt"),
        queryPath: join(artifactRoot, "notification-remote-metadata.sql"),
        schemaDumpPath: join(artifactRoot, "notification-remote-schema.sql"),
      },
      containers: {
        "psql-version": `${projectId}-psql-version`,
        "pg-dump-version": `${projectId}-pg-dump-version`,
        "metadata-before": `${projectId}-metadata-before`,
        "schema-dump": `${projectId}-schema-dump`,
        "metadata-after": `${projectId}-metadata-after`,
      },
    },
  }
}

async function buildRemoteCollectorRuntimeFixture(t, subject, randomHex = "a0b1c2d3e4f5") {
  const artifactRoot = await makeArtifactRoot(t)
  const collectorRuntime = await subject.buildNotificationRemoteCollectorRuntime({
    tempRoot: artifactRoot,
    randomBytes: () => Buffer.from(randomHex, "hex"),
    getUid: () => process.getuid(),
    getGid: () => process.getgid(),
  })
  return { artifactRoot, collectorRuntime }
}

async function prepareRemoteCollectorCall(t, root, randomHex = "a0b1c2d3e4f5") {
  const subject = await loadCollectorSubject(root)
  const { artifactRoot, collectorRuntime } = await buildRemoteCollectorRuntimeFixture(
    t,
    subject,
    randomHex,
  )
  return { ...subject, artifactRoot, collectorRuntime }
}

function remoteCollectorContext(artifactRoot, sourceEnvironment, extra = {}) {
  return { approved: true, artifactRoot, sourceEnvironment, ...extra }
}

function remoteDockerPreflightResult(invocation) {
  if (invocation.step === "image-inspect") {
    return {
      code: 0,
      stdout: JSON.stringify([
        "public.ecr.aws/supabase/postgres@sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13",
      ]),
      stderr: "",
    }
  }
  if (invocation.step === "psql-version") {
    return { code: 0, stdout: "psql (PostgreSQL) 17.6\n", stderr: "" }
  }
  if (invocation.step === "pg-dump-version") {
    return { code: 0, stdout: "pg_dump (PostgreSQL) 17.6\n", stderr: "" }
  }
  return undefined
}

test("remote Docker invocation은 고정 route만 전달하고 비밀값을 포함하지 않는다", async (t) => {
  const { buildNotificationRemoteDockerInvocation } = await loadSubject()
  const { artifactRoot, runtime } = await remoteDockerRuntimeFixture(t)
  const sourceEnvironment = {
    ...sourceEnvironmentFixture(),
    PGHOST: "override.example.test",
    PGPORT: "6543",
    PGUSER: "override-user",
    PGDATABASE: "override-db",
    PGSSLMODE: "disable",
    PGSSLROOTCERT: "/tmp/override-ca.crt",
    DATABASE_URL: "postgresql://postgres:override-password@override.example.test:6543/override-db",
  }
  const commonEnvironment = {
    LANG: "ko_KR.UTF-8",
    LC_ALL: "C",
    PATH: "/usr/bin:/bin",
    TMPDIR: "/private/tmp",
  }
  const remoteEnvironment = {
    ...commonEnvironment,
    PGHOST: "aws-1-ap-northeast-2.pooler.supabase.com",
    PGPORT: "5432",
    PGUSER: "postgres.slnjqlzzhewblvttiidk",
    PGDATABASE: "postgres",
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: "/qa/prod-ca-2021.crt",
    PGCONNECT_TIMEOUT: "30",
  }
  const dockerRunBase = [
    "run", "--rm", "--pull", "never", "--interactive",
    "--name", "tips_notify_collector_qa_a0b1c2d3e4f5-metadata-before",
    "--label", "com.supabase.cli.project=tips_notify_collector_qa_a0b1c2d3e4f5",
    "--read-only",
    "--user", "501:20",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m",
    "--network", "bridge",
    "--env", "PGHOST",
    "--env", "PGPORT",
    "--env", "PGUSER",
    "--env", "PGDATABASE",
    "--env", "PGSSLMODE",
    "--env", "PGSSLROOTCERT",
    "--env", "PGCONNECT_TIMEOUT",
    "--mount",
    `type=bind,src=${join(repoRoot, "supabase", "certs", "prod-ca-2021.crt")},dst=/qa/prod-ca-2021.crt,readonly`,
  ]
  const metadataBefore = buildNotificationRemoteDockerInvocation("metadata-before", {
    runtime,
    sourceEnvironment,
  })
  const schemaDump = buildNotificationRemoteDockerInvocation("schema-dump", {
    runtime,
    sourceEnvironment,
  })
  const metadataAfter = buildNotificationRemoteDockerInvocation("metadata-after", {
    runtime,
    sourceEnvironment,
  })
  const psqlVersion = buildNotificationRemoteDockerInvocation("psql-version", {
    runtime,
    sourceEnvironment,
  })
  const pgDumpVersion = buildNotificationRemoteDockerInvocation("pg-dump-version", {
    runtime,
    sourceEnvironment,
  })
  const imageInspect = buildNotificationRemoteDockerInvocation("image-inspect", {
    runtime,
    sourceEnvironment,
  })

  assert.deepEqual(metadataBefore, {
    step: "metadata-before",
    command: "/Users/hyunjun/.local/bin/docker",
    args: [
      ...dockerRunBase,
      "--mount",
      `type=bind,src=${join(artifactRoot, "notification-remote-metadata.sql")},dst=/qa/notification-remote-metadata.sql,readonly`,
      "--entrypoint", "psql",
      "public.ecr.aws/supabase/postgres:17.6.1.132@sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13",
      "--no-psqlrc", "--password", "--quiet", "--tuples-only", "--no-align",
      "--set", "ON_ERROR_STOP=1", "--file", "/qa/notification-remote-metadata.sql",
    ],
    cwd: join(artifactRoot, "remote-collector"),
    shell: false,
    env: remoteEnvironment,
    stdinMode: "database-password-prompt",
    timeoutMs: 60_000,
    maxStdoutBytes: 2_097_152,
    maxStderrBytes: 65_536,
  })
  assert.deepEqual(schemaDump, {
    step: "schema-dump",
    command: "/Users/hyunjun/.local/bin/docker",
    args: [
      ...dockerRunBase.map((entry) => entry === "tips_notify_collector_qa_a0b1c2d3e4f5-metadata-before"
        ? "tips_notify_collector_qa_a0b1c2d3e4f5-schema-dump" : entry),
      "--mount",
      `type=bind,src=${join(artifactRoot, "notification-remote-schema.sql")},dst=/qa/notification-remote-schema.sql`,
      "--entrypoint", "pg_dump",
      "public.ecr.aws/supabase/postgres:17.6.1.132@sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13",
      "--password", "--schema-only",
      "--schema", "public", "--schema", "dashboard_private",
      "--file", "/qa/notification-remote-schema.sql",
    ],
    cwd: join(artifactRoot, "remote-collector"),
    shell: false,
    env: remoteEnvironment,
    stdinMode: "database-password-prompt",
    timeoutMs: 1_200_000,
    maxStdoutBytes: 65_536,
    maxStderrBytes: 65_536,
  })
  assert.deepEqual(metadataAfter.args, [
    ...dockerRunBase.map((entry) => entry === "tips_notify_collector_qa_a0b1c2d3e4f5-metadata-before"
      ? "tips_notify_collector_qa_a0b1c2d3e4f5-metadata-after" : entry),
    "--mount",
    `type=bind,src=${join(artifactRoot, "notification-remote-metadata.sql")},dst=/qa/notification-remote-metadata.sql,readonly`,
    "--entrypoint", "psql",
    "public.ecr.aws/supabase/postgres:17.6.1.132@sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13",
    "--no-psqlrc", "--password", "--quiet", "--tuples-only", "--no-align",
    "--set", "ON_ERROR_STOP=1", "--file", "/qa/notification-remote-metadata.sql",
  ])
  assert.deepEqual(psqlVersion, {
    step: "psql-version",
    command: "/Users/hyunjun/.local/bin/docker",
    args: [
      "run", "--rm", "--pull", "never",
      "--name", "tips_notify_collector_qa_a0b1c2d3e4f5-psql-version",
      "--label", "com.supabase.cli.project=tips_notify_collector_qa_a0b1c2d3e4f5",
      "--read-only",
      "--user", "501:20",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m",
      "--network", "none",
      "--entrypoint", "psql",
      "public.ecr.aws/supabase/postgres:17.6.1.132@sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13",
      "--version",
    ],
    cwd: join(artifactRoot, "remote-collector"),
    shell: false,
    env: commonEnvironment,
    stdin: "ignore",
    timeoutMs: 30_000,
    maxStdoutBytes: 65_536,
    maxStderrBytes: 65_536,
  })
  assert.deepEqual(pgDumpVersion.args, [
    "run", "--rm", "--pull", "never",
    "--name", "tips_notify_collector_qa_a0b1c2d3e4f5-pg-dump-version",
    "--label", "com.supabase.cli.project=tips_notify_collector_qa_a0b1c2d3e4f5",
    "--read-only",
    "--user", "501:20",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m",
    "--network", "none",
    "--entrypoint", "pg_dump",
    "public.ecr.aws/supabase/postgres:17.6.1.132@sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13",
    "--version",
  ])
  assert.deepEqual(imageInspect, {
    step: "image-inspect",
    command: "/Users/hyunjun/.local/bin/docker",
    args: [
      "image", "inspect", "--format", "{{json .RepoDigests}}",
      "public.ecr.aws/supabase/postgres:17.6.1.132",
    ],
    cwd: join(artifactRoot, "remote-collector"),
    shell: false,
    env: commonEnvironment,
    stdin: "ignore",
    timeoutMs: 30_000,
    maxStdoutBytes: 65_536,
    maxStderrBytes: 65_536,
  })
  for (const invocation of [metadataBefore, schemaDump, metadataAfter, psqlVersion, pgDumpVersion, imageInspect]) {
    assert.equal(Object.isFrozen(invocation), true)
    assert.equal(Object.isFrozen(invocation.args), true)
    assert.equal(Object.isFrozen(invocation.env), true)
    assert.doesNotMatch(
      JSON.stringify(invocation),
      /remote-database-secret|sbp_remote-access-secret|provider-secret|PGPASSWORD|override-password|override\.example/u,
    )
  }
  assert.throws(
    () => buildNotificationRemoteDockerInvocation("metadata-before", {
      runtime: {
        ...runtime,
        files: { ...runtime.files, caPath: `${runtime.files.caPath},unsafe` },
      },
      sourceEnvironment,
    }),
    /notification_local_db_remote_context_refused/u,
  )
})

test("database password는 stdin 완료 뒤에만 zeroize하고 invalid input은 실행 전에 거부한다", async () => {
  const { writeNotificationDatabasePasswordPrompt } = await loadSubject()
  const listeners = new Map()
  let capturedBuffer
  let finishWrite
  const childStdin = {
    once(event, listener) {
      listeners.set(event, listener)
    },
    off(event, listener) {
      if (listeners.get(event) === listener) listeners.delete(event)
    },
    end(buffer, callback) {
      capturedBuffer = buffer
      finishWrite = callback
    },
  }
  let providerCalls = 0
  const writing = writeNotificationDatabasePasswordPrompt(childStdin, () => {
    providerCalls += 1
    return "sentinel-database-password"
  })

  assert.equal(capturedBuffer.toString("utf8"), "sentinel-database-password\n")
  assert.equal(capturedBuffer.every((byte) => byte === 0), false)
  finishWrite()
  await writing
  assert.equal(providerCalls, 1)
  assert.equal(capturedBuffer.every((byte) => byte === 0), true)

  const failingListeners = new Map()
  let failedBuffer
  const failingStdin = {
    once(event, listener) {
      failingListeners.set(event, listener)
    },
    off(event, listener) {
      if (failingListeners.get(event) === listener) failingListeners.delete(event)
    },
    end(buffer) {
      failedBuffer = buffer
      failingListeners.get("error")(new Error("write failed"))
    },
  }
  await assert.rejects(
    () => writeNotificationDatabasePasswordPrompt(failingStdin, () => "sentinel-database-password"),
    /notification_local_db_remote_credential_write_failed/u,
  )
  assert.equal(failedBuffer.every((byte) => byte === 0), true)

  for (const provider of [
    undefined,
    () => "",
    () => "a".repeat(4097),
    () => "contains\u0000nul",
    () => "contains\rreturn",
    () => "contains\nnewline",
  ]) {
    await assert.rejects(
      () => writeNotificationDatabasePasswordPrompt(childStdin, provider),
      /notification_local_db_remote_credential_required/u,
    )
  }
})

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

test("IPv4 Session Pooler collector는 image·client 검증 뒤 schema만 여섯 단계로 수집한다", async (t) => {
  const files = {
    "20260803140000_notification_content_contracts.sql": "select 'content';\n",
    "20260803141000_notification_task_content_payload.sql": "select 'task';\n",
    "20260803142000_notification_word_retest_content_payload.sql": "select 'word';\n",
  }
  const { root } = await makeMigrationRepo(t, files)
  const artifactRoot = await makeArtifactRoot(t)
  const {
    buildNotificationRemoteCollectorRuntime,
    collectRemoteSchemaMetadata,
  } = await loadCollectorSubject(root)
  const collectorRuntime = await buildNotificationRemoteCollectorRuntime({
    tempRoot: artifactRoot,
    randomBytes: () => Buffer.from("a0b1c2d3e4f5", "hex"),
    getUid: () => 501,
    getGid: () => 20,
  })
  const metadataRows = JSON.stringify([{
    notification_local_qa_remote_metadata: remoteMetadataFixture(),
  }])
  const calls = []
  let promptCalls = 0
  const result = await collectRemoteSchemaMetadata({
    approved: true,
    artifactRoot,
    sourceEnvironment: {
      ...sourceEnvironmentFixture(),
      SUPABASE_DB_PASSWORD: "sentinel-database-password",
    },
  }, async (invocation, secretInputProvider) => {
    calls.push(invocation)
    if (invocation.step === "image-inspect") {
      return {
        code: 0,
        stdout: JSON.stringify([
          "public.ecr.aws/supabase/postgres@sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13",
        ]),
        stderr: "",
      }
    }
    if (invocation.step === "psql-version") {
      return { code: 0, stdout: "psql (PostgreSQL) 17.6\n", stderr: "" }
    }
    if (invocation.step === "pg-dump-version") {
      return { code: 0, stdout: "pg_dump (PostgreSQL) 17.6\n", stderr: "" }
    }
    promptCalls += 1
    assert.equal(secretInputProvider(), "sentinel-database-password")
    if (invocation.step === "schema-dump") {
      await writeFile(
        collectorRuntime.files.schemaDumpPath,
        "-- PostgreSQL database dump\ncreate schema if not exists dashboard_private;\n",
      )
      return { code: 0, stdout: "", stderr: "Password: " }
    }
    return { code: 0, stdout: metadataRows, stderr: "Password: " }
  }, { collectorRuntime })

  assert.deepEqual(calls.map(({ step }) => step), [
    "image-inspect",
    "psql-version",
    "pg-dump-version",
    "metadata-before",
    "schema-dump",
    "metadata-after",
  ])
  assert.equal(promptCalls, 3)
  assert.equal(result.remote.postgresMajor, 17)
  assert.deepEqual(result.safety, { rowDataCopied: 0, productionMutationCount: 0 })
  assert.doesNotMatch(
    JSON.stringify(calls),
    /sentinel-database-password|remote-database-secret|sbp_remote-access-secret|provider-secret|PGPASSWORD/u,
  )
})

test("CA 검증 실패는 Docker child를 만들기 전에 닫힌다", async (t) => {
  const { root } = await makeMigrationRepo(t, {
    "20260803140000_notification_content_contracts.sql": "select 'content';\n",
  })
  await writeFile(
    join(root, "supabase", "certs", "prod-ca-2021.crt"),
    "tampered certificate\n",
    { mode: 0o644 },
  )
  const {
    collectRemoteSchemaMetadata,
    artifactRoot,
    collectorRuntime,
  } = await prepareRemoteCollectorCall(t, root, "b0b1b2b3b4b5")
  let executeCallCount = 0

  await assert.rejects(
    () => collectRemoteSchemaMetadata(remoteCollectorContext(
      artifactRoot,
      { SUPABASE_DB_PASSWORD: "qa-password" },
    ), async () => {
      executeCallCount += 1
      return { code: 0, stdout: "", stderr: "" }
    }, { collectorRuntime }),
    /notification_local_db_remote_tls_ca_refused/u,
  )
  assert.equal(executeCallCount, 0)
  assert.deepEqual(await readdir(artifactRoot), ["remote-collector"])
})

test("image·client·server-major preflight 실패는 schema dump 전에 exact 단계에서 닫힌다", async (t) => {
  const files = {
    "20260803140000_notification_content_contracts.sql": "select 'content';\n",
    "20260803141000_notification_task_content_payload.sql": "select 'task';\n",
    "20260803142000_notification_word_retest_content_payload.sql": "select 'word';\n",
  }
  const { root } = await makeMigrationRepo(t, files)
  const subject = await loadCollectorSubject(root)
  const cases = [
    {
      name: "image digest drift",
      randomHex: "b1b2b3b4b5b6",
      expectedSteps: ["image-inspect"],
      expectedCode: "notification_local_db_remote_client_image_refused",
      imageDigests: ["public.ecr.aws/supabase/postgres@sha256:0000000000000000000000000000000000000000000000000000000000000000"],
    },
    {
      name: "psql major 16",
      randomHex: "b2b3b4b5b6b7",
      expectedSteps: ["image-inspect", "psql-version"],
      expectedCode: "notification_local_db_remote_client_version_refused",
      psqlVersion: "psql (PostgreSQL) 16.9\n",
    },
    {
      name: "pg_dump major 16",
      randomHex: "b3b4b5b6b7b8",
      expectedSteps: ["image-inspect", "psql-version", "pg-dump-version"],
      expectedCode: "notification_local_db_remote_client_version_refused",
      pgDumpVersion: "pg_dump (PostgreSQL) 16.9\n",
    },
    {
      name: "server major 16",
      randomHex: "b4b5b6b7b8b9",
      expectedSteps: [
        "image-inspect",
        "psql-version",
        "pg-dump-version",
        "metadata-before",
      ],
      expectedCode: "notification_local_db_remote_client_version_refused",
      serverVersionNum: 160009,
    },
  ]

  for (const scenario of cases) {
    const { artifactRoot, collectorRuntime } = await buildRemoteCollectorRuntimeFixture(
      t,
      subject,
      scenario.randomHex,
    )
    const calls = []
    await assert.rejects(
      () => subject.collectRemoteSchemaMetadata(remoteCollectorContext(
        artifactRoot,
        { SUPABASE_DB_PASSWORD: "qa-password" },
      ), async (invocation, secretInputProvider) => {
        calls.push(invocation.step)
        if (invocation.step === "image-inspect") {
          assert.equal(secretInputProvider, undefined)
          return {
            code: 0,
            stdout: JSON.stringify(scenario.imageDigests ?? [
              "public.ecr.aws/supabase/postgres@sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13",
            ]),
            stderr: "",
          }
        }
        if (invocation.step === "psql-version") {
          assert.equal(secretInputProvider, undefined)
          return {
            code: 0,
            stdout: scenario.psqlVersion ?? "psql (PostgreSQL) 17.6\n",
            stderr: "",
          }
        }
        if (invocation.step === "pg-dump-version") {
          assert.equal(secretInputProvider, undefined)
          return {
            code: 0,
            stdout: scenario.pgDumpVersion ?? "pg_dump (PostgreSQL) 17.6\n",
            stderr: "",
          }
        }
        assert.equal(invocation.step, "metadata-before")
        assert.equal(typeof secretInputProvider, "function")
        const metadata = remoteMetadataFixture()
        metadata.server_version_num = scenario.serverVersionNum
        return {
          code: 0,
          stdout: JSON.stringify([{ notification_local_qa_remote_metadata: metadata }]),
          stderr: "",
        }
      }, { collectorRuntime }),
      new RegExp(scenario.expectedCode, "u"),
      scenario.name,
    )
    assert.deepEqual(calls, scenario.expectedSteps, scenario.name)
    assert.equal(calls.includes("schema-dump"), false, scenario.name)
    assert.deepEqual(await readdir(artifactRoot), ["remote-collector"], scenario.name)
  }
})

test("remote collector는 metadata→schema dump→동일 metadata 순서만 실행한다", async (t) => {
  const files = {
    "20260803140000_notification_content_contracts.sql": "select 'content';\n",
    "20260803141000_notification_task_content_payload.sql": "select 'task';\n",
    "20260803142000_notification_word_retest_content_payload.sql": "select 'word';\n",
  }
  const { root } = await makeMigrationRepo(t, files)
  const subject = await loadCollectorSubject(root)
  const { artifactRoot, collectorRuntime } = await buildRemoteCollectorRuntimeFixture(
    t,
    subject,
    "a1b2c3d4e5f6",
  )
  const calls = []
  const metadataRows = JSON.stringify([{
    notification_local_qa_remote_metadata: remoteMetadataFixture(),
  }])
  const schemaSource = "-- schema-only fixture\ncreate schema if not exists dashboard_private;\n"
  const execute = async (invocation, secretInputProvider) => {
    calls.push(invocation)
    if (invocation.step === "image-inspect") {
      return {
        code: 0,
        stdout: JSON.stringify([
          "public.ecr.aws/supabase/postgres@sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13",
        ]),
        stderr: "",
      }
    }
    if (invocation.step === "psql-version") {
      return { code: 0, stdout: "psql (PostgreSQL) 17.6\n", stderr: "" }
    }
    if (invocation.step === "pg-dump-version") {
      return { code: 0, stdout: "pg_dump (PostgreSQL) 17.6\n", stderr: "" }
    }
    assert.equal(secretInputProvider(), "database-password-must-not-leak")
    if (invocation.step === "schema-dump") {
      await writeFile(collectorRuntime.files.schemaDumpPath, schemaSource)
      return { code: 0, stdout: "Dumped schema.\n", stderr: "" }
    }
    return { code: 0, stdout: metadataRows, stderr: "" }
  }
  const { collectRemoteSchemaMetadata } = subject

  const result = await collectRemoteSchemaMetadata({
    approved: true,
    artifactRoot,
    sourceEnvironment: Object.assign(Object.create({ processEnvironmentLike: true }), {
      HOME: "/Users/qa",
      PATH: "/usr/bin:/bin",
      SUPABASE_ACCESS_TOKEN: "sbp_remote-access-secret",
      SUPABASE_DB_PASSWORD: "database-password-must-not-leak",
      GOOGLE_CHAT_WEBHOOK_URL: "https://chat.googleapis.com/v1/spaces/private/messages?key=secret",
    }),
  }, execute, { collectorRuntime })

  assert.deepEqual(calls.map((call) => call.step), [
    "image-inspect",
    "psql-version",
    "pg-dump-version",
    "metadata-before",
    "schema-dump",
    "metadata-after",
  ])
  assert.equal(calls.every((call) => call.command === "/Users/hyunjun/.local/bin/docker"), true)
  assert.equal(calls.every((call) => call.cwd === collectorRuntime.workdir), true)
  assert.equal(calls.every((call) => Object.isFrozen(call) && Object.isFrozen(call.args)), true)
  assert.equal(calls.every((call) => !("SUPABASE_DB_PASSWORD" in call.env)), true)
  assert.equal(calls.every((call) => !("GOOGLE_CHAT_WEBHOOK_URL" in call.env)), true)
  assert.equal(calls.every((call) => !("SUPABASE_ACCESS_TOKEN" in call.env)), true)
  assert.equal(calls.every((call) => Object.isFrozen(call.env)), true)
  assert.doesNotMatch(
    JSON.stringify(calls.map(({ command, args, cwd }) => ({ command, args, cwd }))),
    /database-password|remote-access-secret|chat\.googleapis|PGPASSWORD/u,
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
  assert.equal(result.migrationManifest.version, 2)
  assert.match(result.migrationManifest.sha256, /^[a-f0-9]{64}$/u)
  assert.equal(result.migrationManifest.catalog.length, 3)
  assert.deepEqual(
    result.migrationManifest.catalog.map(({ version, name }) => ({ version, name })),
    [...remotePrefix, {
      version: "20260803142000",
      name: "notification_word_retest_content_payload",
    }],
  )
  assert.equal(result.migrationManifest.pending.length, 1)
  assert.equal(
    result.migrationManifest.pending[0].sha256,
    sha256(files["20260803142000_notification_word_retest_content_payload.sql"]),
  )
  assert.deepEqual(result.safety, { rowDataCopied: 0, productionMutationCount: 0 })
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.remote), true)
  assert.equal(Object.isFrozen(result.migrationManifest.catalog), true)
  assert.equal(Object.isFrozen(result.migrationManifest.pending), true)
  assert.doesNotMatch(
    JSON.stringify(result),
    /must-not-survive|database-password|remote-access-secret|chat\.googleapis/u,
  )

  assert.deepEqual((await readdir(artifactRoot)).sort(), [
    "notification-remote-metadata.json",
    "notification-remote-metadata.sql",
    "notification-remote-schema.sql",
    "remote-collector",
  ])
  for (const fileName of (await readdir(artifactRoot)).filter((value) => value !== "remote-collector")) {
    const fileStat = await lstat(join(artifactRoot, fileName))
    assert.equal(fileStat.isFile(), true)
    assert.equal(fileStat.mode & 0o777, 0o600)
  }
  assert.equal(await readFile(result.artifacts.schemaDumpPath, "utf8"), schemaSource)
  assert.deepEqual(JSON.parse(await readFile(result.artifacts.metadataPath, "utf8")), result.remote)
})

test("remote collector signal은 active child close 뒤 artifact를 정리한다", async (t) => {
  const fileName = "20260803140000_notification_content_contracts.sql"
  const { root } = await makeMigrationRepo(t, { [fileName]: "select 1;\n" })
  const artifactRoot = await makeArtifactRoot(t)
  const abortController = new AbortController()
  let markStarted
  const started = new Promise((resolvePromise) => { markStarted = resolvePromise })
  let childDrained = false
  const {
    buildNotificationRemoteCollectorRuntime,
    collectRemoteSchemaMetadata,
  } = await loadCollectorSubject(root)
  const collectorRuntime = await buildNotificationRemoteCollectorRuntime({
    tempRoot: artifactRoot,
    randomBytes: () => Buffer.from("102030405060", "hex"),
    getUid: () => process.getuid(),
    getGid: () => process.getgid(),
  })
  const outcome = collectRemoteSchemaMetadata({
    approved: true,
    artifactRoot,
    sourceEnvironment: { SUPABASE_DB_PASSWORD: "qa-password" },
    abortSignal: abortController.signal,
  }, async (invocation) => {
    assert.equal(invocation.abortSignal, abortController.signal)
    assert.equal(invocation.cwd, collectorRuntime.workdir)
    markStarted()
    return new Promise((resolvePromise) => {
      invocation.abortSignal.addEventListener("abort", () => {
        setTimeout(() => {
          childDrained = true
          resolvePromise({ code: 1, stdout: "", stderr: "" })
        }, 10)
      }, { once: true })
    })
  }, { collectorRuntime }).then((value) => ({ value }), (error) => ({ error }))
  await started

  abortController.abort(new Error("notification_local_db_signal_received"))
  const { error, value } = await outcome

  assert.equal(value, undefined)
  assert.equal(childDrained, true)
  assert.match(String(error), /notification_local_db_signal_received/u)
  assert.deepEqual(await readdir(artifactRoot), ["remote-collector"])
})

test("remote collector는 production ref와 run-unique Docker label을 분리하고 exact container만 정리한다", async (t) => {
  const artifactRoot = await makeArtifactRoot(t)
  const {
    buildNotificationRemoteCollectorRuntime,
    createNotificationRemoteCollectorCleanupController,
  } = await loadSubject()
  const runtime = await buildNotificationRemoteCollectorRuntime({
    tempRoot: artifactRoot,
    randomBytes: (size) => {
      assert.equal(size, 6)
      return Buffer.from("a0b1c2d3e4f5", "hex")
    },
  })
  const containerId = "a".repeat(64)
  const calls = []
  let listCallCount = 0
  const controller = createNotificationRemoteCollectorCleanupController({
    runtime,
    sourceEnvironment: {
      PATH: "/usr/bin:/bin",
      SUPABASE_ACCESS_TOKEN: "sbp_must-not-reach-docker",
      SUPABASE_DB_PASSWORD: "db-password-must-not-reach-docker",
      GOOGLE_CHAT_WEBHOOK_URL: "https://chat.googleapis.com/must-not-reach-docker",
    },
    executeProcess: async (invocation) => {
      calls.push(invocation)
      if (invocation.args[0] === "ps") {
        listCallCount += 1
        return {
          code: 0,
          stdout: listCallCount === 1
            ? `${"c".repeat(64)}|${parentProjectRef}\n`
            : listCallCount === 2 ? `${containerId}\n` : "",
          stderr: "",
        }
      }
      assert.deepEqual(invocation.args, ["rm", "--force", containerId])
      return { code: 0, stdout: containerId, stderr: "" }
    },
  })
  const abortController = new AbortController()

  assert.deepEqual(await controller.preflight(abortController.signal), {
    ownedContainersBefore: 0,
  })
  assert.deepEqual(await controller.cleanup(), {
    cleanupCode: "notification_local_db_cleanup_ok",
    evidence: { ownedContainersRemaining: 0, removedContainerCount: 1 },
  })
  assert.deepEqual(await controller.cleanup(), {
    cleanupCode: "notification_local_db_cleanup_ok",
    evidence: { ownedContainersRemaining: 0, removedContainerCount: 1 },
  })

  assert.equal(runtime.projectId, "tips_notify_collector_qa_a0b1c2d3e4f5")
  assert.equal(runtime.version, 2)
  assert.equal(runtime.uid, process.getuid())
  assert.equal(runtime.gid, process.getgid())
  assert.deepEqual(runtime.route, expectedRemotePoolerRoute)
  assert.deepEqual(runtime.client, expectedRemoteClientImage)
  assert.deepEqual(Object.keys(runtime.containers).sort(), [
    "metadata-after",
    "metadata-before",
    "pg-dump-version",
    "psql-version",
    "schema-dump",
  ])
  assert.equal((await lstat(runtime.workdir)).mode & 0o777, 0o700)
  assert.deepEqual(await readdir(runtime.workdir), [])
  assert.equal(calls.length, 4)
  assert.deepEqual(calls.map(({ args }) => args[0]), ["ps", "ps", "rm", "ps"])
  assert.equal(calls[0].abortSignal, abortController.signal)
  assert.equal(calls.slice(1).every((call) => call.abortSignal === undefined), true)
  assert.equal(calls.every((call) => call.cwd === runtime.workdir), true)
  assert.equal(calls.every((call) => call.env.PATH === "/usr/bin:/bin"), true)
  assert.equal(calls.every((call) => !("SUPABASE_ACCESS_TOKEN" in call.env)), true)
  assert.equal(calls.every((call) => !("SUPABASE_DB_PASSWORD" in call.env)), true)
  assert.equal(calls.every((call) => !("GOOGLE_CHAT_WEBHOOK_URL" in call.env)), true)
  assert.deepEqual(calls[0].args, [
    "ps", "-a", "--no-trunc",
    "--filter", "label=com.supabase.cli.project",
    "--format", "{{.ID}}|{{.Label \"com.supabase.cli.project\"}}",
  ])
  assert.match(calls[1].args.at(-1), new RegExp(`${runtime.projectId}$`, "u"))
})

test("remote collector label 충돌은 소유권 획득·삭제 전에 거부한다", async (t) => {
  const artifactRoot = await makeArtifactRoot(t)
  const {
    buildNotificationRemoteCollectorRuntime,
    createNotificationRemoteCollectorCleanupController,
  } = await loadSubject()
  const runtime = await buildNotificationRemoteCollectorRuntime({
    tempRoot: artifactRoot,
    randomBytes: () => Buffer.from("001122334455", "hex"),
  })
  const previousProjectId = "tips_notify_collector_qa_deadbeefcafe"
  const calls = []
  const controller = createNotificationRemoteCollectorCleanupController({
    runtime,
    sourceEnvironment: { PATH: "/usr/bin:/bin" },
    executeProcess: async (invocation) => {
      calls.push(invocation)
      return {
        code: 0,
        stdout: `${"b".repeat(64)}|${previousProjectId}\n`,
        stderr: "",
      }
    },
  })

  await assert.rejects(
    () => controller.preflight(),
    /notification_local_db_remote_container_preexisting_refused/u,
  )
  assert.deepEqual(await controller.cleanup(), {
    cleanupCode: "notification_local_db_cleanup_not_required",
    evidence: { ownedContainersRemaining: 0, removedContainerCount: 0 },
  })
  assert.equal(calls.length, 1)
  assert.equal(calls.some((call) => call.args[0] === "rm"), false)
})

test("remote collector 실패와 container cleanup 실패를 safe evidence로 함께 보존한다", async (t) => {
  const artifactRoot = await makeArtifactRoot(t)
  const {
    buildNotificationRemoteCollectorRuntime,
    runNotificationRemoteCollectorWithCleanup,
  } = await loadSubject()
  const collectorRuntime = await buildNotificationRemoteCollectorRuntime({
    tempRoot: artifactRoot,
    randomBytes: () => Buffer.from("112233445566", "hex"),
  })
  const calls = []
  let caught

  try {
    await runNotificationRemoteCollectorWithCleanup({
      collectorContext: { approved: true },
      collectorRuntime,
      cleanupController: {
        preflight: async () => { calls.push("preflight") },
        cleanup: async () => {
          calls.push("cleanup")
          return { cleanupCode: "notification_local_db_cleanup_failed" }
        },
      },
      collect: async () => {
        calls.push("collect")
        const failure = new Error("raw-secret")
        failure.code = "notification_local_db_remote_schema_dump_failed"
        failure.evidence = {
          primaryCode: "notification_local_db_remote_schema_dump_failed",
          cleanupCode: "notification_local_db_cleanup_ok",
        }
        throw failure
      },
      execute: async () => assert.fail("fake collector owns execution in this scenario"),
    })
  } catch (error) {
    caught = error
  }

  assert.equal(caught?.code, "notification_local_db_remote_schema_dump_failed")
  assert.deepEqual(caught?.evidence, {
    primaryCode: "notification_local_db_remote_schema_dump_failed",
    cleanupCode: "notification_local_db_cleanup_failed",
  })
  assert.doesNotMatch(String(caught), /raw-secret/u)
  assert.deepEqual(calls, ["preflight", "collect", "cleanup"])
})

for (const [scenario, cleanup] of [
  ["failed 결과", async () => ({ cleanupCode: "notification_local_db_cleanup_failed" })],
  ["throw", async () => { throw new Error("cleanup-raw-secret") }],
]) {
  test(`remote collector 성공 뒤 cleanup ${scenario}만 발생해도 local 단계 전에 닫힌다`, async (t) => {
    const artifactRoot = await makeArtifactRoot(t)
    const {
      buildNotificationRemoteCollectorRuntime,
      runNotificationRemoteCollectorWithCleanup,
    } = await loadSubject()
    const collectorRuntime = await buildNotificationRemoteCollectorRuntime({
      tempRoot: artifactRoot,
      randomBytes: () => Buffer.from("223344556677", "hex"),
    })
    let localStartCalls = 0
    let caught

    try {
      await runNotificationRemoteCollectorWithCleanup({
        collectorContext: { approved: true },
        collectorRuntime,
        cleanupController: {
          preflight: async () => ({ ownedContainersBefore: 0 }),
          cleanup,
        },
        collect: async () => ({ collected: true }),
        execute: async () => {
          localStartCalls += 1
          return { code: 0, stdout: "", stderr: "" }
        },
      })
    } catch (error) {
      caught = error
    }

    assert.equal(caught?.code, "notification_local_db_remote_collector_failed")
    assert.deepEqual(caught?.evidence, {
      primaryCode: "notification_local_db_remote_collector_failed",
      cleanupCode: "notification_local_db_cleanup_failed",
    })
    assert.doesNotMatch(String(caught), /cleanup-raw-secret/u)
    assert.equal(localStartCalls, 0)
  })
}

test("remote container cleanup 도중 signal이 와도 cleanup drain 후 signal evidence로 닫힌다", async (t) => {
  const artifactRoot = await makeArtifactRoot(t)
  const {
    buildNotificationRemoteCollectorRuntime,
    runNotificationRemoteCollectorWithCleanup,
  } = await loadSubject()
  const collectorRuntime = await buildNotificationRemoteCollectorRuntime({
    tempRoot: artifactRoot,
    randomBytes: () => Buffer.from("66778899aabb", "hex"),
  })
  const abortController = new AbortController()
  let markCleanupStarted
  const cleanupStarted = new Promise((resolvePromise) => { markCleanupStarted = resolvePromise })
  let releaseCleanup
  const cleanupReleased = new Promise((resolvePromise) => { releaseCleanup = resolvePromise })
  const calls = []
  const outcome = runNotificationRemoteCollectorWithCleanup({
    collectorContext: { approved: true, abortSignal: abortController.signal },
    collectorRuntime,
    cleanupController: {
      preflight: async (signal) => {
        assert.equal(signal, abortController.signal)
        calls.push("preflight")
      },
      cleanup: async () => {
        calls.push("cleanup-start")
        markCleanupStarted()
        await cleanupReleased
        calls.push("cleanup-end")
        return { cleanupCode: "notification_local_db_cleanup_ok" }
      },
    },
    collect: async () => {
      calls.push("collect")
      return { collected: true }
    },
    execute: async () => assert.fail("fake collector owns execution in this scenario"),
  }).then((value) => ({ value }), (error) => ({ error }))

  await cleanupStarted
  abortController.abort(new Error("notification_local_db_signal_received"))
  releaseCleanup()
  const { error, value } = await outcome

  assert.equal(value, undefined)
  assert.equal(error?.code, "notification_local_db_signal_received")
  assert.deepEqual(error?.evidence, {
    primaryCode: "notification_local_db_signal_received",
    cleanupCode: "notification_local_db_cleanup_ok",
  })
  assert.deepEqual(calls, ["preflight", "collect", "cleanup-start", "cleanup-end"])
})

test("DB credential이 없으면 artifact와 child process 전에 닫힌다", async (t) => {
  const { root } = await makeMigrationRepo(t, {
    "20260803140000_notification_content_contracts.sql": "select 1;\n",
  })
  const {
    collectRemoteSchemaMetadata,
    artifactRoot,
    collectorRuntime,
  } = await prepareRemoteCollectorCall(t, root, "001122334455")
  let executeCallCount = 0

  await assert.rejects(
    () => collectRemoteSchemaMetadata(remoteCollectorContext(
      artifactRoot,
      { SUPABASE_ACCESS_TOKEN: "sbp_not-enough" },
    ), async () => {
      executeCallCount += 1
      return { code: 0, stdout: "", stderr: "" }
    }, { collectorRuntime }),
    /notification_local_db_remote_credential_required/u,
  )
  assert.equal(executeCallCount, 0)
  assert.deepEqual(await readdir(artifactRoot), ["remote-collector"])
})

test("collector는 caller가 repoRoot를 덮어쓰지 못하게 한다", async (t) => {
  const { root } = await makeMigrationRepo(t, {
    "20260803140000_notification_content_contracts.sql": "select 1;\n",
  })
  const {
    collectRemoteSchemaMetadata,
    artifactRoot,
    collectorRuntime,
  } = await prepareRemoteCollectorCall(t, root, "112233445566")
  let executeCallCount = 0

  await assert.rejects(
    () => collectRemoteSchemaMetadata(remoteCollectorContext(
      artifactRoot,
      { SUPABASE_DB_PASSWORD: "qa-password" },
      {
      repoRoot: root,
      },
    ), async () => {
      executeCallCount += 1
      return { code: 0, stdout: "[]", stderr: "" }
    }, { collectorRuntime }),
    /notification_local_db_remote_context_refused/u,
  )
  assert.equal(executeCallCount, 0)
  assert.deepEqual(await readdir(artifactRoot), ["remote-collector"])
})

test("artifact root는 비어 있는 exact 0700 directory만 허용한다", async (t) => {
  const { root } = await makeMigrationRepo(t, {
    "20260803140000_notification_content_contracts.sql": "select 1;\n",
  })
  const {
    collectRemoteSchemaMetadata,
    artifactRoot,
    collectorRuntime,
  } = await prepareRemoteCollectorCall(t, root, "223344556677")
  await chmod(artifactRoot, 0o500)
  let executeCallCount = 0

  await assert.rejects(
    () => collectRemoteSchemaMetadata(remoteCollectorContext(
      artifactRoot,
      { SUPABASE_DB_PASSWORD: "qa-password" },
    ), async () => {
      executeCallCount += 1
      return { code: 0, stdout: "", stderr: "" }
    }, { collectorRuntime }),
    /notification_local_db_remote_artifact_refused/u,
  )
  assert.equal(executeCallCount, 0)
  await chmod(artifactRoot, 0o700)
})

test("remote child 오류의 raw stderr를 버리고 exact artifact만 정리한다", async (t) => {
  const { root } = await makeMigrationRepo(t, {
    "20260803140000_notification_content_contracts.sql": "select 1;\n",
  })
  const {
    collectRemoteSchemaMetadata,
    artifactRoot,
    collectorRuntime,
  } = await prepareRemoteCollectorCall(t, root, "334455667788")
  let caught
  try {
    await collectRemoteSchemaMetadata(remoteCollectorContext(
      artifactRoot,
      { SUPABASE_DB_PASSWORD: "bare-password-must-not-leak" },
    ), async (invocation) => {
      const preflight = remoteDockerPreflightResult(invocation)
      if (preflight) return preflight
      return {
        code: 1,
        stdout: "postgresql://postgres:bare-password-must-not-leak@db.example.test/postgres",
        stderr: "sb_secret_must-not-leak https://chat.googleapis.com/v1/spaces/private/messages?key=secret",
      }
    }, { collectorRuntime })
  } catch (error) {
    caught = error
  }

  assert.match(String(caught), /notification_local_db_remote_metadata_query_failed/u)
  assert.doesNotMatch(String(caught), /must-not-leak|db\.example|chat\.googleapis/u)
  assert.deepEqual(await readdir(artifactRoot), ["remote-collector"])
})

test("metadata query SQL이 child 실행 중 바뀌면 다음 remote call 전에 거부한다", async (t) => {
  const fileName = "20260803140000_notification_content_contracts.sql"
  const { root } = await makeMigrationRepo(t, { [fileName]: "select 1;\n" })
  const {
    collectRemoteSchemaMetadata,
    artifactRoot,
    collectorRuntime,
  } = await prepareRemoteCollectorCall(t, root, "445566778899")
  let executeCallCount = 0

  await assert.rejects(
    () => collectRemoteSchemaMetadata(remoteCollectorContext(
      artifactRoot,
      { SUPABASE_DB_PASSWORD: "qa-password" },
    ), async (invocation) => {
      executeCallCount += 1
      const preflight = remoteDockerPreflightResult(invocation)
      if (preflight) return preflight
      await writeFile(collectorRuntime.files.queryPath, "delete from public.students;\n")
      return {
        code: 0,
        stdout: JSON.stringify([{
          notification_local_qa_remote_metadata: remoteMetadataFixture([
            migrationIdentity(fileName),
          ]),
        }]),
        stderr: "",
      }
    }, { collectorRuntime }),
    /notification_local_db_remote_query_contract_refused/u,
  )
  assert.equal(executeCallCount, 4)
  assert.deepEqual(await readdir(artifactRoot), ["remote-collector"])
})

test("artifact cleanup 실패는 primary 오류와 함께 보존한다", async (t) => {
  const fileName = "20260803140000_notification_content_contracts.sql"
  const { root } = await makeMigrationRepo(t, { [fileName]: "select 1;\n" })
  const {
    collectRemoteSchemaMetadata,
    artifactRoot,
    collectorRuntime,
  } = await prepareRemoteCollectorCall(t, root, "5566778899aa")
  let caught

  try {
    await collectRemoteSchemaMetadata(remoteCollectorContext(
      artifactRoot,
      { SUPABASE_DB_PASSWORD: "bare-password-must-not-leak" },
    ), async (invocation) => {
      const preflight = remoteDockerPreflightResult(invocation)
      if (preflight) return preflight
      await rm(collectorRuntime.files.queryPath)
      await mkdir(collectorRuntime.files.queryPath, { mode: 0o700 })
      return {
        code: 1,
        stdout: "",
        stderr: "bare-password-must-not-leak",
      }
    }, { collectorRuntime })
  } catch (error) {
    caught = error
  }

  assert.equal(caught?.code, "notification_local_db_remote_metadata_query_failed")
  assert.deepEqual(caught?.evidence, {
    primaryCode: "notification_local_db_remote_metadata_query_failed",
    cleanupCode: "notification_local_db_cleanup_failed",
  })
  assert.doesNotMatch(String(caught), /bare-password-must-not-leak/u)
  assert.equal((await lstat(join(artifactRoot, "notification-remote-metadata.sql"))).isDirectory(), true)
})

test("schema collector 실패와 artifact cleanup 실패를 분리된 evidence로 보존한다", async (t) => {
  const fileName = "20260803140000_notification_content_contracts.sql"
  const { root } = await makeMigrationRepo(t, { [fileName]: "select 1;\n" })
  const {
    collectRemoteSchemaMetadata,
    artifactRoot,
    collectorRuntime,
  } = await prepareRemoteCollectorCall(t, root, "66778899aabb")
  const metadataRows = JSON.stringify([{
    notification_local_qa_remote_metadata: remoteMetadataFixture([migrationIdentity(fileName)]),
  }])
  let caught

  try {
    await collectRemoteSchemaMetadata(remoteCollectorContext(
      artifactRoot,
      { SUPABASE_DB_PASSWORD: "bare-password-must-not-leak" },
    ), async (invocation) => {
      const preflight = remoteDockerPreflightResult(invocation)
      if (preflight) return preflight
      if (invocation.step === "metadata-before") {
        return { code: 0, stdout: metadataRows, stderr: "" }
      }
      await rm(collectorRuntime.files.schemaDumpPath)
      await mkdir(collectorRuntime.files.schemaDumpPath, { mode: 0o700 })
      return { code: 1, stdout: "", stderr: "bare-password-must-not-leak" }
    }, { collectorRuntime })
  } catch (error) {
    caught = error
  }

  assert.equal(caught?.code, "notification_local_db_remote_schema_dump_failed")
  assert.deepEqual(caught?.evidence, {
    primaryCode: "notification_local_db_remote_schema_dump_failed",
    cleanupCode: "notification_local_db_cleanup_failed",
  })
  assert.doesNotMatch(String(caught), /bare-password-must-not-leak/u)
  assert.equal((await lstat(join(artifactRoot, "notification-remote-schema.sql"))).isDirectory(), true)
})

test("metadata 전후 snapshot이 다르면 schema artifact를 폐기한다", async (t) => {
  const { root } = await makeMigrationRepo(t, {
    "20260803140000_notification_content_contracts.sql": "select 1;\n",
    "20260803141000_notification_task_content_payload.sql": "select 2;\n",
  })
  const {
    collectRemoteSchemaMetadata,
    artifactRoot,
    collectorRuntime,
  } = await prepareRemoteCollectorCall(t, root, "778899aabbcc")
  const rows = [
    remoteMetadataFixture([migrationIdentity("20260803140000_notification_content_contracts.sql")]),
    remoteMetadataFixture([
      migrationIdentity("20260803140000_notification_content_contracts.sql"),
      migrationIdentity("20260803141000_notification_task_content_payload.sql"),
    ]),
  ]
  let metadataIndex = 0
  let executeCallCount = 0

  await assert.rejects(
    () => collectRemoteSchemaMetadata(remoteCollectorContext(
      artifactRoot,
      { SUPABASE_DB_PASSWORD: "qa-password" },
    ), async (invocation) => {
      executeCallCount += 1
      const preflight = remoteDockerPreflightResult(invocation)
      if (preflight) return preflight
      if (invocation.step === "schema-dump") {
        await writeFile(collectorRuntime.files.schemaDumpPath, "create schema dashboard_private;\n")
        return { code: 0, stdout: "", stderr: "" }
      }
      const metadata = rows[metadataIndex]
      metadataIndex += 1
      return {
        code: 0,
        stdout: JSON.stringify([{ notification_local_qa_remote_metadata: metadata }]),
        stderr: "",
      }
    }, { collectorRuntime }),
    /notification_local_db_remote_snapshot_changed/u,
  )
  assert.equal(executeCallCount, 6)
  assert.deepEqual(await readdir(artifactRoot), ["remote-collector"])
})

test("read-only metadata shape와 schema-only artifact identity를 엄격히 검사한다", async (t) => {
  const { root } = await makeMigrationRepo(t, {
    "20260803140000_notification_content_contracts.sql": "select 1;\n",
  })
  const subject = await loadCollectorSubject(root)
  const { collectRemoteSchemaMetadata } = subject

  for (const scenario of [
    "not-read-only",
    "object-only",
    "data-dump",
    "mode-drift",
    "replaced-dump",
  ]) {
    const { artifactRoot, collectorRuntime } = await buildRemoteCollectorRuntimeFixture(
      t,
      subject,
      scenario === "not-read-only"
        ? "8899aabbccdd"
        : scenario === "object-only" ? "99aabbccddee"
          : scenario === "data-dump" ? "aabbccddeeff"
            : scenario === "mode-drift" ? "bbccddee0011" : "ccddee001122",
    )
    let executeCallCount = 0
    await assert.rejects(
      () => collectRemoteSchemaMetadata(remoteCollectorContext(
        artifactRoot,
        { SUPABASE_DB_PASSWORD: "qa-password" },
      ), async (invocation) => {
        executeCallCount += 1
        const preflight = remoteDockerPreflightResult(invocation)
        if (preflight) return preflight
        if (invocation.step === "schema-dump") {
          const schemaPath = collectorRuntime.files.schemaDumpPath
          if (scenario === "replaced-dump") await rm(schemaPath)
          await writeFile(
            schemaPath,
            scenario === "data-dump"
              ? "-- Data for Name: students\nCOPY public.students FROM stdin;\n"
              : "create schema dashboard_private;\n",
            { mode: 0o600 },
          )
          if (scenario === "mode-drift") await chmod(schemaPath, 0o644)
          return { code: 0, stdout: "", stderr: "" }
        }
        const metadata = remoteMetadataFixture([
          migrationIdentity("20260803140000_notification_content_contracts.sql"),
        ])
        if (scenario === "not-read-only") metadata.transaction_read_only = false
        return {
          code: 0,
          stdout: JSON.stringify(
            scenario === "object-only"
              ? metadata
              : [{ notification_local_qa_remote_metadata: metadata }],
          ),
          stderr: "",
        }
      }, { collectorRuntime }),
      scenario === "not-read-only" || scenario === "object-only"
        ? /notification_local_db_remote_metadata_invalid/u
        : /notification_local_db_remote_schema_dump_refused/u,
    )
    assert.equal(
      executeCallCount,
      scenario === "not-read-only" || scenario === "object-only" ? 4 : 5,
    )
    assert.deepEqual(await readdir(artifactRoot), ["remote-collector"])
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

test("승인되지 않은 실행은 child process 전에 닫힌다", async () => {
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
      databaseBootstrap: {
        supabaseCliVersion: "2.103.0",
        authSchemaMigrator: "one-shot-internal-network",
        steadyStateContainers: ["database"],
      },
      syntheticFixture: {
        settingsRegistry: 196,
        rules: 197,
        operationalRows: 0,
      },
      pgTapFileCount: 14,
      pgTapFiles: expectedPgTapFiles,
      providerEgressBlocked: true,
      remoteCollector: {
        mode: "shared-supavisor-session",
        host: "aws-1-ap-northeast-2.pooler.supabase.com",
        port: 5432,
        sslmode: "verify-full",
        clientImage:
          "public.ecr.aws/supabase/postgres:17.6.1.132@sha256:e09e93a61ed1560caf4be79c9eb29401875bea74b12aec4657cb08bf34ea3a13",
        clientMajor: 17,
        schemas: ["public", "dashboard_private"],
        productionRowDataCopied: 0,
        productionMutationCount: 0,
      },
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

test("runner source에는 Preview Branch command가 남지 않는다", () => {
  assert.doesNotMatch(
    runnerSource,
    /["']branches["']\s*,\s*["'](?:list|create|get|delete)["']/u,
  )
})

test("주입된 random과 loopback port로 deterministic validated runtime manifest를 만든다", async (t) => {
  const { manifest, portCalls, randomCalls, tempRoot } = await buildRuntimeManifest(t)
  const {
    assertNotificationLocalRuntimeManifest,
    buildNotificationLocalRuntimeManifest,
  } = await loadSubject()

  assert.deepEqual(randomCalls, [6])
  assert.deepEqual(portCalls, ["127.0.0.1"])
  assert.equal(manifest.version, 1)
  assert.equal(manifest.projectId, expectedRuntimeProjectId)
  assert.equal(manifest.tempRoot, tempRoot)
  assert.deepEqual(manifest.database, {
    host: "127.0.0.1",
    port: 55432,
    database: "postgres",
    url: "postgresql://postgres:postgres@127.0.0.1:55432/postgres",
  })
  assert.deepEqual(manifest.dockerNetwork, {
    name: `${expectedRuntimeProjectId}_internal`,
    driver: "bridge",
    hostBindingIpv4: "127.0.0.1",
    internal: true,
    minimumServerMajor: 28,
  })
  assert.deepEqual(manifest.migrationCatalog, migrationCatalogFixture)
  assert.deepEqual(manifest.pendingMigrations, [pendingMigrationFixture])
  assert.deepEqual(manifest.ownership.label, {
    key: expectedOwnershipLabelKey,
    value: expectedRuntimeProjectId,
  })
  assert.deepEqual(manifest.ownership.containers, [`supabase_db_${expectedRuntimeProjectId}`])
  assert.deepEqual(manifest.ownership.volumes, [`supabase_db_${expectedRuntimeProjectId}`])
  assert.deepEqual(manifest.ownership.networks, [`${expectedRuntimeProjectId}_internal`])
  assert.equal(manifest.fixture.sqlSha256, "d".repeat(64))
  assert.deepEqual(manifest.pgTap.files.map(({ relativePath }) => relativePath), expectedPgTapFiles)
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/u)
  assert.equal(assertNotificationLocalRuntimeManifest(manifest), manifest)
  assert.equal(Object.isFrozen(manifest), true)
  assert.equal(Object.isFrozen(manifest.pendingMigrations), true)
  assert.equal(Object.isFrozen(manifest.ownership), true)

  const second = await buildNotificationLocalRuntimeManifest({
    randomBytes: () => Buffer.from(injectedRandomBytes),
    allocateLoopbackPort: async () => 55432,
    tempRoot,
    migrationCatalog: migrationCatalogFixture.map((entry) => ({ ...entry })),
    pendingMigrations: [{ ...pendingMigrationFixture }],
    fixtureContract: fixtureContractFixture(),
  })
  assert.deepEqual(second, manifest)
})

test("runtime manifest의 loopback·internal network·owned label·pending hash drift를 거부한다", async (t) => {
  const { manifest } = await buildRuntimeManifest(t)
  const { assertNotificationLocalRuntimeManifest } = await loadSubject()
  const mutations = [
    (value) => { value.projectId = "tips_notification_db_qa_../../outside" },
    (value) => { value.database.host = "host.docker.internal" },
    (value) => { value.database.port = 5432 },
    (value) => { value.dockerNetwork.internal = false },
    (value) => { value.dockerNetwork.name = "bridge" },
    (value) => { value.dockerNetwork.driver = "host" },
    (value) => { value.dockerNetwork.hostBindingIpv4 = "0.0.0.0" },
    (value) => { value.dockerNetwork.minimumServerMajor = 27 },
    (value) => { value.ownership.label.key = "unowned" },
    (value) => { value.ownership.containers[0] = "preexisting-container" },
    (value) => { value.ownership.networks = [] },
    (value) => { value.migrationCatalog[0].sha256 = "not-a-hash" },
    (value) => { value.migrationCatalog.splice(1, 1) },
    (value) => { value.pendingMigrations[0].relativePath = "../outside.sql" },
    (value) => { value.pendingMigrations[0] = value.migrationCatalog[0] },
    (value) => { value.pendingMigrations[0].sha256 = "not-a-hash" },
    (value) => { value.sha256 = "0".repeat(64) },
  ]

  for (const mutate of mutations) {
    const candidate = structuredClone(manifest)
    mutate(candidate)
    assert.throws(
      () => assertNotificationLocalRuntimeManifest(candidate),
      /notification_local_db_runtime_manifest_refused/u,
    )
  }
})

test("runtime manifest builder는 0700 real temp directory가 아니면 random·port 전에 거부한다", async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "tips-notification-runtime-root-"))
  const realRoot = join(parent, "real")
  const linkedRoot = join(parent, "linked")
  await mkdir(realRoot, { mode: 0o700 })
  await symlink(realRoot, linkedRoot)
  t.after(() => rm(parent, { recursive: true, force: true }))
  const { buildNotificationLocalRuntimeManifest } = await loadSubject()
  let randomCalls = 0
  let portCalls = 0
  const options = (tempRoot) => ({
    randomBytes: () => {
      randomCalls += 1
      return Buffer.from(injectedRandomBytes)
    },
    allocateLoopbackPort: async () => {
      portCalls += 1
      return 55432
    },
    tempRoot,
    migrationCatalog: migrationCatalogFixture,
    pendingMigrations: [{ ...pendingMigrationFixture }],
    fixtureContract: fixtureContractFixture(),
  })

  await assert.rejects(
    () => buildNotificationLocalRuntimeManifest(options(linkedRoot)),
    /notification_local_db_runtime_manifest_refused/u,
  )
  await chmod(realRoot, 0o755)
  await assert.rejects(
    () => buildNotificationLocalRuntimeManifest(options(realRoot)),
    /notification_local_db_runtime_manifest_refused/u,
  )
  assert.equal(randomCalls, 0)
  assert.equal(portCalls, 0)
})

test("Docker 28+·internal bridge·loopback 기본 bind를 DB start 전에 exact 검증한다", async (t) => {
  const { manifest } = await buildRuntimeManifest(t)
  const {
    assertNotificationDockerNetworkContract,
    assertNotificationDockerServerVersion,
  } = await loadSubject()
  const network = {
    Id: expectedDockerNetworkId,
    Name: manifest.dockerNetwork.name,
    Driver: "bridge",
    Scope: "local",
    Internal: true,
    EnableIPv6: false,
    Labels: {
      [expectedOwnershipLabelKey]: manifest.projectId,
      "com.supabase.cli.project": manifest.projectId,
    },
    Options: {
      "com.docker.network.bridge.host_binding_ipv4": "127.0.0.1",
    },
  }

  assert.equal(assertNotificationDockerServerVersion('"28.0.0"', 28), 28)
  assert.equal(assertNotificationDockerServerVersion('"29.1.2"', 28), 29)
  for (const value of ['"27.5.1"', '"dev"', "", "null"]) {
    assert.throws(
      () => assertNotificationDockerServerVersion(value, 28),
      /notification_local_db_docker_version_refused/u,
    )
  }
  assert.deepEqual(
    assertNotificationDockerNetworkContract(JSON.stringify(network), manifest),
    { networkId: expectedDockerNetworkId },
  )

  for (const mutate of [
    (value) => { value.Driver = "overlay" },
    (value) => { value.Scope = "swarm" },
    (value) => { value.Internal = false },
    (value) => { value.EnableIPv6 = true },
    (value) => { value.Options["com.docker.network.bridge.host_binding_ipv4"] = "0.0.0.0" },
    (value) => { value.Labels[expectedOwnershipLabelKey] = "another-run" },
    (value) => { value.Labels["com.supabase.cli.project"] = "another-run" },
  ]) {
    const candidate = structuredClone(network)
    mutate(candidate)
    assert.throws(
      () => assertNotificationDockerNetworkContract(JSON.stringify(candidate), manifest),
      /notification_local_db_network_contract_refused/u,
    )
  }
})

test("Supabase CLI는 검토한 2.103.0만 허용한다", async () => {
  const { assertNotificationSupabaseCliVersion } = await loadSubject()
  assert.equal(assertNotificationSupabaseCliVersion("2.103.0\n"), "2.103.0")
  for (const value of ["2.102.9", "2.104.0", "v2.103.0", "2.103.0 extra", "", null]) {
    assert.throws(
      () => assertNotificationSupabaseCliVersion(value),
      /notification_local_db_supabase_version_refused/u,
    )
  }
})

test("DB container는 exact network 하나와 127.0.0.1 port binding 하나만 허용한다", async (t) => {
  const { manifest } = await buildRuntimeManifest(t)
  const { assertNotificationLocalDatabaseContainerContract } = await loadSubject()
  const container = {
    Name: `/${manifest.ownership.containers[0]}`,
    Config: { Labels: { "com.supabase.cli.project": manifest.projectId } },
    HostConfig: { NetworkMode: manifest.dockerNetwork.name },
    NetworkSettings: {
      Ports: {
        "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55432" }],
      },
      Networks: {
        [manifest.dockerNetwork.name]: { NetworkID: expectedDockerNetworkId },
      },
    },
  }

  assert.deepEqual(
    assertNotificationLocalDatabaseContainerContract(
      JSON.stringify(container),
      manifest,
      expectedDockerNetworkId,
    ),
    { databasePort: 55432, networkId: expectedDockerNetworkId },
  )

  for (const mutate of [
    (value) => { value.NetworkSettings.Ports["5432/tcp"][0].HostIp = "0.0.0.0" },
    (value) => { value.NetworkSettings.Ports["5432/tcp"][0].HostIp = "::" },
    (value) => { value.NetworkSettings.Ports["5432/tcp"].push({ HostIp: "::1", HostPort: "55432" }) },
    (value) => { value.NetworkSettings.Ports["5432/tcp"][0].HostPort = "55433" },
    (value) => { value.NetworkSettings.Ports["8080/tcp"] = [{ HostIp: "127.0.0.1", HostPort: "58080" }] },
    (value) => { value.NetworkSettings.Networks.bridge = { NetworkID: "8".repeat(64) } },
    (value) => { value.HostConfig.NetworkMode = expectedDockerNetworkId },
  ]) {
    const candidate = structuredClone(container)
    mutate(candidate)
    assert.throws(
      () => assertNotificationLocalDatabaseContainerContract(
        JSON.stringify(candidate),
        manifest,
        expectedDockerNetworkId,
      ),
      /notification_local_db_start_binding_refused/u,
    )
  }
})

test("DB start 뒤에는 DB container·volume·internal network만 남아야 한다", async (t) => {
  const { manifest } = await buildRuntimeManifest(t)
  const { assertNotificationLocalRuntimeResourceSet } = await loadSubject()
  const expected = [
    { kind: "container", name: manifest.ownership.containers[0] },
    { kind: "volume", name: manifest.ownership.volumes[0] },
    { kind: "network", name: manifest.ownership.networks[0] },
  ]

  assert.deepEqual(assertNotificationLocalRuntimeResourceSet(expected, manifest), expected)
  for (const resources of [
    expected.slice(0, -1),
    [...expected, { kind: "container", name: `supabase_auth_${manifest.projectId}` }],
    expected.map((entry, index) => index === 0 ? { ...entry, name: "another-db" } : entry),
    [expected[1], expected[0], expected[2]],
  ]) {
    assert.throws(
      () => assertNotificationLocalRuntimeResourceSet(resources, manifest),
      /notification_local_db_start_resource_refused/u,
    )
  }
})

test("전체 verified migration catalog를 stage하고 pending은 exact suffix로만 유지한다", async (t) => {
  const files = {
    "20260803140000_notification_content_contracts.sql": "select 'applied-a';\n",
    "20260803141000_notification_task_content_payload.sql": "select 'applied-b';\n",
    "20260803142000_notification_word_retest_content_payload.sql": "select 'pending-c';\n",
  }
  const { root } = await makeMigrationRepo(t, files)
  const catalog = Object.entries(files).map(([fileName, contents]) => {
    const match = /^(\d{14})_([a-z0-9_]+)\.sql$/u.exec(fileName)
    return {
      version: match[1],
      name: match[2],
      fileName,
      relativePath: `supabase/migrations/${fileName}`,
      sha256: sha256(contents),
    }
  })
  const tempRoot = await mkdtemp(join(tmpdir(), "tips-notification-catalog-runtime-"))
  await chmod(tempRoot, 0o700)
  t.after(() => rm(tempRoot, { recursive: true, force: true }))
  const {
    assertNotificationLocalRuntimeManifest,
    buildNotificationLocalRuntimeManifest,
    stageNotificationMigrationCatalog,
  } = await loadSubject()
  const manifest = await buildNotificationLocalRuntimeManifest({
    randomBytes: () => Buffer.from(injectedRandomBytes),
    allocateLoopbackPort: async () => 55432,
    tempRoot,
    migrationCatalog: catalog,
    pendingMigrations: [catalog.at(-1)],
    fixtureContract: fixtureContractFixture(),
  })
  await mkdir(join(tempRoot, "supabase", "migrations"), { recursive: true, mode: 0o700 })

  const staged = await stageNotificationMigrationCatalog(manifest, { repoRoot: root })

  assert.deepEqual(staged, manifest.migrationCatalog)
  assert.deepEqual(
    (await readdir(join(tempRoot, "supabase", "migrations"))).sort(),
    Object.keys(files).sort(),
  )
  for (const [fileName, contents] of Object.entries(files)) {
    const destination = join(tempRoot, "supabase", "migrations", fileName)
    assert.equal(await readFile(destination, "utf8"), contents)
    assert.equal(Number((await lstat(destination)).mode & 0o777), 0o600)
  }

  const driftRoot = await mkdtemp(join(tmpdir(), "tips-notification-catalog-drift-"))
  await chmod(driftRoot, 0o700)
  t.after(() => rm(driftRoot, { recursive: true, force: true }))
  const driftManifest = await buildNotificationLocalRuntimeManifest({
    randomBytes: () => Buffer.from("010203040506", "hex"),
    allocateLoopbackPort: async () => 55433,
    tempRoot: driftRoot,
    migrationCatalog: catalog,
    pendingMigrations: [catalog.at(-1)],
    fixtureContract: fixtureContractFixture(),
  })
  await mkdir(join(driftRoot, "supabase", "migrations"), { recursive: true, mode: 0o700 })
  await writeFile(
    join(root, catalog.at(-1).relativePath),
    "select 'source-drift';\n",
    { mode: 0o600 },
  )
  await assert.rejects(
    () => stageNotificationMigrationCatalog(driftManifest, { repoRoot: root }),
    /notification_local_db_migration_failed/u,
  )

  const invalidPending = structuredClone(manifest)
  invalidPending.pendingMigrations = [invalidPending.migrationCatalog[0]]
  assert.throws(
    () => assertNotificationLocalRuntimeManifest(invalidPending),
    /notification_local_db_runtime_manifest_refused/u,
  )
})

test("dry-run은 stdout·stderr를 합쳐 exact pending filename 집합만 허용한다", async () => {
  const { parseNotificationMigrationDryRun } = await loadSubject()
  const expected = [pendingMigrationFixture]
  assert.deepEqual(
    parseNotificationMigrationDryRun({
      stdout: "",
      stderr: [
        "Connecting to local database...",
        "Would push these migrations:",
        ` • ${pendingMigrationFixture.fileName}`,
      ].join("\n"),
    }, expected),
    [pendingMigrationFixture.fileName],
  )
  assert.deepEqual(
    parseNotificationMigrationDryRun({
      stdout: "Local database is up to date.\n",
      stderr: "",
    }, []),
    [],
  )

  for (const result of [
    { stdout: "", stderr: "Would push these migrations:" },
    { stdout: pendingMigrationFixture.version, stderr: "Would push these migrations:" },
    {
      stdout: `warning about ${pendingMigrationFixture.fileName}`,
      stderr: "Would push these migrations:",
    },
    {
      stdout: "",
      stderr: `Would push these migrations:\n${pendingMigrationFixture.fileName}\n20260803143000_extra.sql`,
    },
  ]) {
    assert.throws(
      () => parseNotificationMigrationDryRun(result, expected),
      /notification_local_db_migration_failed/u,
    )
  }
})

test("pgTAP은 raw plan line 대신 pg_prove의 exact 14-file PASS summary를 판정한다", async () => {
  const { assertNotificationPgTapSummary } = await loadSubject()
  const success = [
    "All tests successful.",
    "Files=14, Tests=59,  3 wallclock secs",
    "Result: PASS",
  ].join("\n")
  assert.deepEqual(assertNotificationPgTapSummary(success, 14), {
    fileCount: 14,
    testCount: 59,
  })

  for (const output of [
    "All tests successful.\nFiles=13, Tests=59\nResult: PASS",
    "All tests successful.\nFiles=14, Tests=0\nResult: PASS",
    "Files=14, Tests=59\nResult: PASS",
    "All tests successful.\nFiles=14, Tests=59\nResult: FAIL",
    "All tests successful.\nFiles=14, Tests=59\nResult: PASS\nDubious, test returned 1",
    "All tests successful.\nFiles=14, Tests=59\nResult: PASS\nnot ok 3",
  ]) {
    assert.throws(
      () => assertNotificationPgTapSummary(output, 14),
      /notification_local_db_pgtap_failed/u,
    )
  }
})

test("child environment는 local만 만들고 remote/provider secret을 제거한다", async (t) => {
  const { manifest } = await buildRuntimeManifest(t)
  const { buildNotificationQaChildEnvironments } = await loadSubject()
  const sourceEnvironment = sourceEnvironmentFixture()
  const environments = buildNotificationQaChildEnvironments({
    sourceEnvironment,
    runtimeManifest: manifest,
  })

  assert.deepEqual(Object.keys(environments), ["local"])
  assert.equal(environments.local.PGHOST, "127.0.0.1")
  assert.equal(environments.local.PGPORT, "55432")
  assert.equal(environments.local.PGDATABASE, "postgres")
  assert.equal(environments.local.PGUSER, "postgres")
  assert.equal(environments.local.PGPASSWORD, "postgres")
  assert.equal(environments.local.SUPABASE_PROJECT_ID, expectedRuntimeProjectId)
  assert.equal(environments.local.DOCKER_NETWORK_NAME, manifest.dockerNetwork.name)
  assert.equal("SUPABASE_ACCESS_TOKEN" in environments.local, false)
  assert.equal("SUPABASE_DB_PASSWORD" in environments.local, false)
  assert.equal(
    Object.keys(environments.local).some((key) => (
      /GOOGLE_CHAT|WEBHOOK|SLACK|RESEND|TWILIO/u.test(key)
    )),
    false,
  )
  assert.doesNotMatch(
    JSON.stringify(environments.local),
    /remote-access-secret|remote-database-secret|provider-secret|service-account-secret|email-secret|sms-secret/u,
  )
  assert.doesNotMatch(
    JSON.stringify(environments),
    /provider-secret|service-account-secret|email-secret|sms-secret/u,
  )
  assert.equal(Object.isFrozen(environments), true)
  assert.equal(Object.isFrozen(environments.local), true)
})

test("trusted executor는 fake subprocess transcript로 17단계 command를 실제 조합한다", async (t) => {
  const migrationCatalog = await loadRepositoryMigrationCatalog()
  assert.ok(migrationCatalog.length > 1)
  const pendingMigrations = [migrationCatalog.at(-1)]
  const appliedMigrations = migrationCatalog
    .slice(0, -1)
    .map(({ version, name }) => ({ version, name }))
  const fixtureModule = await import(
    new URL("../scripts/notification-content-local-qa-fixture.mjs", import.meta.url).href
  )
  const fixtureContract = await fixtureModule.loadNotificationContentLocalQaContract()
  const tempRoot = await mkdtemp(join(tmpdir(), "tips-notification-trusted-executor-"))
  await chmod(tempRoot, 0o700)
  t.after(() => rm(tempRoot, { recursive: true, force: true }))
  const schemaContents = "-- schema-only trusted executor fixture\ncreate schema dashboard_private;\n"
  const schemaDumpPath = join(tempRoot, "notification-remote-schema.sql")
  await writeFile(schemaDumpPath, schemaContents, { mode: 0o600 })
  const {
    buildNotificationLocalRuntimeManifest,
    createNotificationLocalQaExecutor,
    runNotificationIsolatedDbQa,
  } = await loadSubject()
  const manifest = await buildNotificationLocalRuntimeManifest({
    randomBytes: () => Buffer.from(injectedRandomBytes),
    allocateLoopbackPort: async () => 55432,
    tempRoot,
    migrationCatalog,
    pendingMigrations,
    fixtureContract,
  })
  const migrationManifestCore = {
    version: 2,
    applied: appliedMigrations,
    catalog: manifest.migrationCatalog,
    pending: manifest.pendingMigrations,
  }
  const remoteCollection = {
    project: { projectRef: parentProjectRef, region: "ap-northeast-2" },
    remote: {
      transactionReadOnly: true,
      serverVersionNum: 170006,
      postgresMajor: 17,
      migrations: appliedMigrations,
    },
    migrationManifest: {
      ...migrationManifestCore,
      sha256: sha256(JSON.stringify(migrationManifestCore)),
    },
    artifacts: {
      schemaDumpPath,
      schemaDumpSha256: sha256(schemaContents),
    },
    safety: { rowDataCopied: 0, productionMutationCount: 0 },
  }
  const networkPayload = JSON.stringify({
    Id: expectedDockerNetworkId,
    Name: manifest.dockerNetwork.name,
    Driver: "bridge",
    Scope: "local",
    Internal: true,
    EnableIPv6: false,
    Labels: {
      [expectedOwnershipLabelKey]: manifest.projectId,
      "com.supabase.cli.project": manifest.projectId,
    },
    Options: {
      "com.docker.network.bridge.host_binding_ipv4": "127.0.0.1",
    },
  })
  const containerPayload = JSON.stringify({
    Name: `/${manifest.ownership.containers[0]}`,
    Config: { Labels: { "com.supabase.cli.project": manifest.projectId } },
    HostConfig: { NetworkMode: manifest.dockerNetwork.name },
    NetworkSettings: {
      Ports: {
        "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55432" }],
      },
      Networks: {
        [manifest.dockerNetwork.name]: { NetworkID: expectedDockerNetworkId },
      },
    },
  })
  const jsonAlias = (alias, value) => JSON.stringify([{ [alias]: value }])
  const safetyEvidence = {
    workerProcesses: 0,
    workerHeartbeats: 0,
    cronJobs: 0,
    pgNetQueuedRequests: 0,
    foreignServers: 0,
    queueRows: 0,
    enabledDispatchFlags: 0,
    outboundExtensions: [],
  }
  const processCalls = []
  let localConfigContractChecked = false
  const executeProcess = async (call) => {
    processCalls.push(call)
    const args = call.args
    const filePath = args[args.indexOf("--file") + 1]
    const fileName = typeof filePath === "string" ? filePath.split("/").at(-1) : ""
    const success = (stdout = "", stderr = "") => ({ code: 0, stdout, stderr })

    if (args[0] === "version") return success('"28.0.0"\n')
    if (call.step === "preexisting-resource-check") return success()
    if (call.step === "internal-network-create" && args[1] === "create") {
      return success(`${expectedDockerNetworkId}\n`)
    }
    if (args[0] === "network" && args[1] === "inspect") return success(networkPayload)
    if (call.step === "local-db-start" && args[0] === "db" && args[1] === "start") {
      const configPath = join(tempRoot, "supabase", "config.toml")
      const configStat = await lstat(configPath)
      const config = await readFile(configPath, "utf8")
      const sectionEnabled = (section) => {
        const escaped = section.replaceAll(".", "\\.")
        const block = new RegExp(
          `(?:^|\\n)\\[${escaped}\\]\\n([\\s\\S]*?)(?=\\n\\[|$)`,
          "u",
        ).exec(config)?.[1]
        return /^enabled = (true|false)$/mu.exec(block ?? "")?.[1]
      }
      assert.equal(configStat.isFile(), true)
      assert.equal(configStat.isSymbolicLink(), false)
      assert.equal(configStat.mode & 0o777, 0o600)
      assert.equal(sectionEnabled("api"), "false")
      assert.equal(sectionEnabled("db.pooler"), "false")
      assert.equal(sectionEnabled("db.seed"), "false")
      assert.equal(sectionEnabled("realtime"), "false")
      assert.equal(sectionEnabled("storage"), "false")
      assert.equal(sectionEnabled("auth"), "true")
      assert.equal(sectionEnabled("studio"), "false")
      assert.equal(sectionEnabled("inbucket"), "false")
      assert.equal(sectionEnabled("edge_runtime"), "false")
      assert.equal(sectionEnabled("analytics"), "false")
      assert.doesNotMatch(config, /SMTP|TWILIO|WEBHOOK|GOOGLE_CHAT|provider-secret/iu)
      localConfigContractChecked = true
      return success()
    }
    if (call.step === "local-db-start" && args[0] === "inspect") {
      return success(containerPayload)
    }
    if (call.step === "local-db-start" && args[0] === "ps") {
      return success(`${manifest.projectId}|${manifest.ownership.containers[0]}\n`)
    }
    if (call.step === "local-db-start" && args[0] === "volume") {
      return success(`${manifest.projectId}|${manifest.ownership.volumes[0]}\n`)
    }
    if (
      call.step === "local-db-start"
      && args[0] === "network"
      && args[1] === "ls"
    ) {
      return success(`${manifest.projectId}|${manifest.ownership.networks[0]}\n`)
    }
    if (fileName === "local-catalog-postflight.sql") {
      return success(jsonAlias("notification_local_qa_catalog_postflight", {
        roles_ok: true,
        schemas_ok: true,
        extensions_ok: true,
        unexpected_owner_count: 0,
        rls_relation_count: 1,
        rls_policy_count: 1,
        unexpected_public_create_grants: 0,
      }))
    }
    if (call.step === "remote-migration-repair" && args[0] === "migration") {
      return success()
    }
    if (fileName === "local-migration-history-postflight.sql"
      || fileName === "local-migration-history-before-push.sql") {
      return success(jsonAlias("notification_local_qa_migration_history", appliedMigrations))
    }
    if (call.step === "local-migration-push" && args.includes("--dry-run")) {
      return success("", [
        "Would push these migrations:",
        pendingMigrations[0].fileName,
      ].join("\n"))
    }
    if (call.step === "local-migration-push" && args[0] === "db" && args[1] === "push") {
      return success()
    }
    if (fileName === "local-migration-history-after-push.sql") {
      return success(jsonAlias(
        "notification_local_qa_migration_history",
        migrationCatalog.map(({ version, name }) => ({ version, name })),
      ))
    }
    if (fileName === "fixture-postflight.sql") {
      return success(jsonAlias("notification_local_qa_fixture_postflight", {
        ...fixtureContract.manifest.expectedCounts,
        enabledDispatchFlags: 0,
        connectionSecretRows: 0,
      }))
    }
    if (fileName === "local-safety-postflight.sql") {
      return success(jsonAlias("notification_local_qa_safety", safetyEvidence))
    }
    if (fileName === "evidence-read-only.sql") {
      return success(jsonAlias(
        "notification_content_db_evidence",
        actualEvidenceModuleQueryResult("read-only-evidence"),
      ))
    }
    if (fileName === "evidence-round-trip.sql") {
      return success(jsonAlias(
        "notification_content_db_evidence",
        actualEvidenceModuleQueryResult("disposable-round-trip"),
      ))
    }
    if (call.step === "pgtap" && args[0] === "test") {
      return success("All tests successful.\nFiles=14, Tests=59, 1 wallclock secs\nResult: PASS\n")
    }
    if (call.step === "cleanup") return success()
    if (args[0] === "db" && args[1] === "query") return success()
    throw new Error(`unexpected fake subprocess: ${call.step} ${args.join(" ")}`)
  }
  const execute = createNotificationLocalQaExecutor({ executeProcess })

  const result = await runNotificationIsolatedDbQa({
    approved: true,
    runtimeManifest: manifest,
    remoteCollection,
    fixtureContract,
    sourceEnvironment: sourceEnvironmentFixture(),
    execute,
  })

  assert.equal(result.status, "passed")
  assert.equal(localConfigContractChecked, true)
  assert.equal(result.pgTap.fileCount, 14)
  const networkCreate = processCalls.find(({ step, args }) => (
    step === "internal-network-create" && args[1] === "create"
  ))
  assert.equal(networkCreate.args.includes("--internal"), true)
  assert.equal(networkCreate.args.includes("--opt"), true)
  const start = processCalls.find(({ step, args }) => step === "local-db-start" && args[0] === "db")
  assert.equal(start.args[start.args.indexOf("--network-id") + 1], manifest.dockerNetwork.name)
  assert.equal(
    processCalls.filter(({ step, args }) => step === "local-db-start" && (
      args[0] === "ps" || args[0] === "volume" || (args[0] === "network" && args[1] === "ls")
    )).length,
    3,
  )
  const repair = processCalls.find(({ args }) => args[0] === "migration" && args[1] === "repair")
  assert.deepEqual(
    repair.args.slice(2, 2 + appliedMigrations.length),
    appliedMigrations.map(({ version }) => version),
  )
  const pushes = processCalls.filter(({ args }) => args[0] === "db" && args[1] === "push")
  assert.equal(pushes.length, 2)
  assert.equal(pushes[0].args.includes("--dry-run"), true)
  assert.equal(pushes[1].args.includes("--dry-run"), false)
  assert.equal(pushes[1].args.includes("--yes"), true)
  assert.equal(processCalls.some(({ args }) => args[0] === "stop"), true)
  const supabaseCalls = processCalls.filter(({ args }) => (
    args[0] === "db" || args[0] === "migration"
  ))
  assert.ok(supabaseCalls.length > 10)
  assert.equal(
    supabaseCalls.every(({ command }) => command === expectedSupabaseGoCliPath),
    true,
  )
  assert.equal(processCalls.every(({ env }) => !Object.keys(env).some((key) => (
    /SUPABASE_(?:ACCESS_TOKEN|DB_PASSWORD)|GOOGLE_CHAT|WEBHOOK|SLACK|RESEND|TWILIO/u.test(key)
  ))), true)
})

test("trusted migration push는 pending 0개면 dry-run과 history만 확인하고 actual을 생략한다", async (t) => {
  const migrationCatalog = await loadRepositoryMigrationCatalog()
  const appliedMigrations = migrationCatalog.map(({ version, name }) => ({ version, name }))
  const tempRoot = await mkdtemp(join(tmpdir(), "tips-notification-noop-push-"))
  await chmod(tempRoot, 0o700)
  t.after(() => rm(tempRoot, { recursive: true, force: true }))
  const {
    buildNotificationLocalQaInvocation,
    buildNotificationLocalRuntimeManifest,
    buildNotificationQaChildEnvironments,
    createNotificationLocalQaExecutor,
    stageNotificationMigrationCatalog,
  } = await loadSubject()
  const manifest = await buildNotificationLocalRuntimeManifest({
    randomBytes: () => Buffer.from("0a0b0c0d0e0f", "hex"),
    allocateLoopbackPort: async () => 55434,
    tempRoot,
    migrationCatalog,
    pendingMigrations: [],
    fixtureContract: fixtureContractFixture(),
  })
  await mkdir(join(tempRoot, "supabase", "migrations"), { recursive: true, mode: 0o700 })
  await stageNotificationMigrationCatalog(manifest)
  const environments = buildNotificationQaChildEnvironments({
    sourceEnvironment: sourceEnvironmentFixture(),
    runtimeManifest: manifest,
  })
  const processCalls = []
  const executeProcess = async (call) => {
    processCalls.push(call)
    const filePath = call.args[call.args.indexOf("--file") + 1]
    const fileName = typeof filePath === "string" ? filePath.split("/").at(-1) : ""
    if (
      fileName === "local-migration-history-before-push.sql"
      || fileName === "local-migration-history-after-push.sql"
    ) {
      return {
        code: 0,
        stdout: JSON.stringify([{
          notification_local_qa_migration_history: appliedMigrations,
        }]),
        stderr: "",
      }
    }
    if (call.args[0] === "db" && call.args[1] === "push" && call.args.includes("--dry-run")) {
      return { code: 0, stdout: "Local database is up to date.\n", stderr: "" }
    }
    throw new Error(`unexpected no-op subprocess: ${call.args.join(" ")}`)
  }
  const execute = createNotificationLocalQaExecutor({ executeProcess })
  const invocation = buildNotificationLocalQaInvocation("local-migration-push", {
    runtimeManifest: manifest,
    localEnvironment: environments.local,
    state: {
      localStartAttempted: true,
      signalReceived: false,
      dockerNetworkId: expectedDockerNetworkId,
    },
    executionContract: { appliedMigrations },
  })

  const result = await execute(invocation)

  assert.equal(result.code, 0)
  assert.deepEqual(result.evidence, {
    dryRunPassed: true,
    appliedPendingVersions: [],
  })
  const pushes = processCalls.filter(({ args }) => args[0] === "db" && args[1] === "push")
  assert.equal(pushes.length, 1)
  assert.equal(pushes[0].args.includes("--dry-run"), true)
})

test("fake executor로 17개 local orchestration을 exact order로 실행하고 cleanup 0 evidence를 남긴다", async (t) => {
  const { manifest } = await buildRuntimeManifest(t)
  const calls = []
  const evidenceCalls = []
  const execute = makeFakeExecutor(manifest, calls)
  const { runNotificationIsolatedDbQa } = await loadSubject()

  const result = await runNotificationIsolatedDbQa(orchestrationContext(
    manifest,
    execute,
    { evidenceCalls },
  ))

  assert.deepEqual(calls.map(({ step }) => step), exactLocalOrchestrationSteps)
  assert.equal(calls.filter(({ step }) => step === "cleanup").length, 1)
  assert.equal(calls.every(Object.isFrozen), true)
  assert.equal(calls.every(({ args, env }) => Object.isFrozen(args) && Object.isFrozen(env)), true)
  const networkCall = calls.find(({ step }) => step === "internal-network-create")
  assert.equal(networkCall.command, "docker")
  assert.deepEqual(networkCall.args.slice(0, 2), ["network", "create"])
  assert.equal(networkCall.args.includes("--internal"), true)
  assert.deepEqual(
    networkCall.args.slice(
      networkCall.args.indexOf("--opt"),
      networkCall.args.indexOf("--opt") + 2,
    ),
    ["--opt", "com.docker.network.bridge.host_binding_ipv4=127.0.0.1"],
  )
  assert.equal(
    networkCall.args.includes(`${expectedOwnershipLabelKey}=${expectedRuntimeProjectId}`),
    true,
  )
  assert.equal(networkCall.args.at(-1), manifest.dockerNetwork.name)
  const startCall = calls.find(({ step }) => step === "local-db-start")
  assert.equal(startCall.command, expectedSupabaseGoCliPath)
  assert.deepEqual(startCall.args.slice(0, 2), ["db", "start"])
  assert.equal(startCall.args[startCall.args.indexOf("--workdir") + 1], manifest.tempRoot)
  assert.equal(
    startCall.args[startCall.args.indexOf("--network-id") + 1],
    manifest.dockerNetwork.name,
  )
  const pgTapCall = calls.find(({ step }) => step === "pgtap")
  assert.equal(
    pgTapCall.args[pgTapCall.args.indexOf("--network-id") + 1],
    manifest.dockerNetwork.name,
  )
  const localCalls = calls.filter(({ step }) => step !== "preexisting-resource-check")
  assert.equal(localCalls.every(({ env }) => env.PGHOST === "127.0.0.1"), true)
  assert.equal(localCalls.every(({ env }) => !("SUPABASE_ACCESS_TOKEN" in env)), true)
  assert.equal(localCalls.every(({ env }) => !("SUPABASE_DB_PASSWORD" in env)), true)
  assert.doesNotMatch(
    JSON.stringify(calls),
    /remote-access-secret|remote-database-secret|provider-secret|service-account-secret|email-secret|sms-secret/u,
  )
  assert.deepEqual(evidenceCalls.map(({ disposable }) => disposable), [false, true])
  assert.equal(evidenceCalls.every(({ query }) => typeof query === "function"), true)

  assert.equal(result.status, "passed")
  assert.equal(result.runtimeManifestSha256, manifest.sha256)
  assert.deepEqual(result.orchestration.steps, exactLocalOrchestrationSteps)
  assert.equal(result.orchestration.localStartAttempted, true)
  assert.deepEqual(result.counts, expectedFixtureCounts)
  assert.deepEqual(result.pgTap, { fileCount: 14, passed: 14, failed: 0 })
  assert.deepEqual(result.safety, {
    productionRowDataCopied: 0,
    productionMutationCount: 0,
    providerEgressBlocked: true,
    workerProcesses: 0,
    queueDelta: 0,
    preflightEnabledDispatchFlags: 0,
    postflightEnabledDispatchFlags: 0,
  })
  assert.deepEqual(result.cleanup, {
    attempts: 1,
    ownedResourcesRemaining: 0,
    containersRemaining: 0,
    volumesRemaining: 0,
    networksRemaining: 0,
  })
  assert.equal(Object.isFrozen(result), true)
})

test("실제 evidence 모듈도 controlled query adapter를 통해서만 두 mode를 검증한다", async (t) => {
  const { manifest } = await buildRuntimeManifest(t)
  const calls = []
  const baseExecute = makeFakeExecutor(manifest, calls)
  const execute = async (invocation) => {
    if (invocation.step === "read-only-evidence" || invocation.step === "disposable-round-trip") {
      calls.push(invocation)
      return {
        code: 0,
        stdout: "",
        stderr: "",
        evidence: actualEvidenceModuleQueryResult(invocation.step),
      }
    }
    return baseExecute(invocation)
  }
  const context = orchestrationContext(manifest, execute)
  delete context.runEvidence
  const { runNotificationIsolatedDbQa } = await loadSubject()

  const result = await runNotificationIsolatedDbQa(context)

  assert.equal(result.status, "passed")
  assert.deepEqual(
    calls.filter(({ step }) => /evidence|round-trip/u.test(step)).map(({ step }) => step),
    ["read-only-evidence", "disposable-round-trip"],
  )
  assert.equal(
    calls.some(({ command, args }) => (
      command === process.execPath
      && args.some((value) => /notification-content-db-evidence/u.test(value))
    )),
    false,
  )
})

test("caller-supplied manifest는 trusted default executor에 직접 연결되지 않는다", async (t) => {
  const { manifest } = await buildRuntimeManifest(t)
  const { runNotificationIsolatedDbQa } = await loadSubject()
  const context = orchestrationContext(manifest, undefined)

  await assert.rejects(
    () => runNotificationIsolatedDbQa(context),
    /notification_local_db_executor_refused/u,
  )
})

test("remote migration catalog 분해와 manifest SHA drift는 local command 전에 거부한다", async (t) => {
  const { manifest } = await buildRuntimeManifest(t)
  const calls = []
  const context = orchestrationContext(manifest, makeFakeExecutor(manifest, calls))
  context.remoteCollection = structuredClone(context.remoteCollection)
  context.remoteCollection.migrationManifest.sha256 = "0".repeat(64)
  const { runNotificationIsolatedDbQa } = await loadSubject()

  await assert.rejects(
    () => runNotificationIsolatedDbQa(context),
    /notification_local_db_execution_contract_refused/u,
  )
  assert.equal(calls.length, 0)
})

test("exact owned label의 pre-existing resource가 하나라도 있으면 생성·cleanup 전에 거부한다", async (t) => {
  const { manifest } = await buildRuntimeManifest(t)
  const calls = []
  const { runNotificationIsolatedDbQa } = await loadSubject()
  const execute = async (invocation) => {
    calls.push(invocation)
    return {
      code: 0,
      stdout: "",
      stderr: "",
      evidence: {
        dockerServerMajor: 28,
        ownedResourceCount: 1,
        resources: [{ kind: "container", name: manifest.ownership.containers[0] }],
      },
    }
  }
  let caught

  try {
    await runNotificationIsolatedDbQa(orchestrationContext(manifest, execute))
  } catch (error) {
    caught = error
  }

  assert.equal(caught?.code, "notification_local_db_preexisting_resource_refused")
  assert.deepEqual(calls.map(({ step }) => step), ["preexisting-resource-check"])
  assert.equal(calls.some(({ step }) => step === "internal-network-create"), false)
  assert.equal(calls.some(({ step }) => step === "local-db-start"), false)
  assert.equal(calls.some(({ step }) => step === "cleanup"), false)
})

test("internal network create partial failure도 start 없이 exact cleanup 1회로 닫힌다", async (t) => {
  const { manifest } = await buildRuntimeManifest(t)
  const calls = []
  const execute = makeFakeExecutor(manifest, calls, { failStep: "internal-network-create" })
  const { runNotificationIsolatedDbQa } = await loadSubject()
  let caught

  try {
    await runNotificationIsolatedDbQa(orchestrationContext(manifest, execute))
  } catch (error) {
    caught = error
  }

  assert.equal(caught?.code, "notification_local_db_network_failed")
  assert.deepEqual(caught?.evidence, {
    primaryCode: "notification_local_db_network_failed",
    cleanupCode: "notification_local_db_cleanup_ok",
  })
  assert.equal(calls.some(({ step }) => step === "local-db-start"), false)
  assert.equal(calls.filter(({ step }) => step === "cleanup").length, 1)
})

for (const [failStep, primaryCode] of [
  ["local-db-start", "notification_local_db_start_failed"],
  ["schema-restore", "notification_local_db_restore_failed"],
  ["local-migration-push", "notification_local_db_migration_failed"],
  ["synthetic-fixture-install", "notification_local_db_fixture_failed"],
  ["read-only-evidence", "notification_local_db_evidence_failed"],
  ["disposable-round-trip", "notification_local_db_evidence_failed"],
  ["pgtap", "notification_local_db_pgtap_failed"],
]) {
  test(`${failStep} 실패는 localStartAttempted 이후 exact cleanup 1회와 safe code를 보존한다`, async (t) => {
    const { manifest } = await buildRuntimeManifest(t)
    const calls = []
    const execute = makeFakeExecutor(manifest, calls, { failStep })
    const { runNotificationIsolatedDbQa } = await loadSubject()
    let caught

    try {
      await runNotificationIsolatedDbQa(orchestrationContext(manifest, execute))
    } catch (error) {
      caught = error
    }

    assert.equal(caught?.code, primaryCode)
    assert.deepEqual(caught?.evidence, {
      primaryCode,
      cleanupCode: "notification_local_db_cleanup_ok",
    })
    assert.equal(Object.isFrozen(caught?.evidence), true)
    assert.equal(calls.filter(({ step }) => step === "cleanup").length, 1)
    assert.equal(calls.at(-1).step, "cleanup")
    const startCall = calls.find(({ step }) => step === "local-db-start")
    assert.equal(startCall?.state.localStartAttempted, true)
    assert.doesNotMatch(
      `${String(caught)}\n${JSON.stringify(caught?.evidence)}`,
      /primary-secret|cleanup-secret|provider-secret|chat\.googleapis|sbp_/u,
    )
  })
}

test("primary 실패와 cleanup 실패를 raw 출력 없이 두 개의 safe code로 함께 보존한다", async (t) => {
  const { manifest } = await buildRuntimeManifest(t)
  const calls = []
  const execute = makeFakeExecutor(manifest, calls, {
    failStep: "read-only-evidence",
    cleanupFails: true,
  })
  const { runNotificationIsolatedDbQa } = await loadSubject()
  let caught

  try {
    await runNotificationIsolatedDbQa(orchestrationContext(manifest, execute))
  } catch (error) {
    caught = error
  }

  assert.equal(caught?.code, "notification_local_db_evidence_failed")
  assert.deepEqual(caught?.evidence, {
    primaryCode: "notification_local_db_evidence_failed",
    cleanupCode: "notification_local_db_cleanup_failed",
  })
  assert.equal(calls.filter(({ step }) => step === "cleanup").length, 1)
  assert.doesNotMatch(
    `${String(caught)}\n${JSON.stringify(caught?.evidence)}`,
    /primary-secret|cleanup-secret|provider-secret|chat\.googleapis|sbp_/u,
  )
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`${signal}은 동일 signal handler의 idempotent cleanup controller로 들어간다`, async (t) => {
    const { manifest } = await buildRuntimeManifest(t)
    const calls = []
    const execute = makeFakeExecutor(manifest, calls)
    const { buildNotificationQaChildEnvironments, createNotificationLocalCleanupController } =
      await loadSubject()
    const environments = buildNotificationQaChildEnvironments({
      sourceEnvironment: sourceEnvironmentFixture(),
      runtimeManifest: manifest,
    })
    const controller = createNotificationLocalCleanupController({
      runtimeManifest: manifest,
      localEnvironment: environments.local,
      execute,
    })

    assert.equal(controller.signalHandlers.SIGINT, controller.signalHandlers.SIGTERM)
    const first = await controller.signalHandlers[signal](signal)
    const second = await controller.signalHandlers[signal](signal)

    assert.deepEqual(first, {
      primaryCode: "notification_local_db_signal_received",
      cleanupCode: "notification_local_db_cleanup_deferred",
    })
    assert.deepEqual(second, first)
    assert.equal(calls.filter(({ step }) => step === "cleanup").length, 0)
    const cleanup = await controller.cleanup()
    assert.equal(cleanup.cleanupCode, "notification_local_db_cleanup_ok")
    assert.equal(calls.filter(({ step }) => step === "cleanup").length, 1)
    assert.equal(Object.isFrozen(controller), true)
  })
}

test("설치된 signal lifecycle은 child abort를 먼저 표시하고 cleanup을 finally로 미룬다", async (t) => {
  const { manifest } = await buildRuntimeManifest(t)
  const calls = []
  const state = { localStartAttempted: true, signalReceived: false }
  const execute = makeFakeExecutor(manifest, calls)
  const {
    buildNotificationQaChildEnvironments,
    createNotificationLocalCleanupController,
    installLocalQaSignalLifecycle,
  } = await loadSubject()
  const environments = buildNotificationQaChildEnvironments({
    sourceEnvironment: sourceEnvironmentFixture(),
    runtimeManifest: manifest,
  })
  const controller = createNotificationLocalCleanupController({
    runtimeManifest: manifest,
    localEnvironment: environments.local,
    execute,
    state,
  })
  const abortController = new AbortController()
  const existingHandlers = new Set(process.listeners("SIGTERM"))
  const existingInterruptHandlers = new Set(process.listeners("SIGINT"))
  const previousExitCode = process.exitCode
  const dispose = installLocalQaSignalLifecycle(controller, abortController)
  t.after(() => {
    dispose()
    process.exitCode = previousExitCode
  })
  const handler = process.listeners("SIGTERM")
    .find((candidate) => !existingHandlers.has(candidate))
  const interruptHandler = process.listeners("SIGINT")
    .find((candidate) => !existingInterruptHandlers.has(candidate))
  assert.equal(typeof handler, "function")
  assert.equal(typeof interruptHandler, "function")

  const evidence = await handler()
  const repeatedEvidence = await interruptHandler()

  assert.equal(state.signalReceived, true)
  assert.equal(abortController.signal.aborted, true)
  assert.deepEqual(evidence, {
    primaryCode: "notification_local_db_signal_received",
    cleanupCode: "notification_local_db_cleanup_deferred",
  })
  assert.deepEqual(repeatedEvidence, evidence)
  assert.equal(process.exitCode, 143)
  assert.equal(calls.length, 0)
  await controller.cleanup()
  assert.equal(calls.filter(({ step }) => step === "cleanup").length, 1)
})

test("active invocation signal은 drain 완료 후 finally에서 exact cleanup 1회를 실행한다", async (t) => {
  const { manifest } = await buildRuntimeManifest(t)
  const calls = []
  let releaseStarted
  const started = new Promise((resolvePromise) => { releaseStarted = resolvePromise })
  let childDrained = false
  const execute = async (invocation) => {
    calls.push(invocation)
    if (invocation.step === "preexisting-resource-check") {
      return {
        code: 0,
        stdout: "",
        stderr: "",
        evidence: successfulStepEvidence(invocation.step, manifest),
      }
    }
    if (invocation.step === "internal-network-create") {
      releaseStarted()
      return new Promise((resolvePromise) => {
        invocation.abortSignal.addEventListener("abort", () => {
          setTimeout(() => {
            childDrained = true
            resolvePromise({ code: 1, stdout: "", stderr: "" })
          }, 10)
        }, { once: true })
      })
    }
    if (invocation.step === "cleanup") {
      assert.equal(childDrained, true)
      return {
        code: 0,
        stdout: "",
        stderr: "",
        evidence: successfulStepEvidence(invocation.step, manifest),
      }
    }
    assert.fail(`unexpected step after signal: ${invocation.step}`)
  }
  const existingHandlers = new Set(process.listeners("SIGTERM"))
  const previousExitCode = process.exitCode
  t.after(() => { process.exitCode = previousExitCode })
  const { runNotificationIsolatedDbQa } = await loadSubject()
  const run = runNotificationIsolatedDbQa(orchestrationContext(manifest, execute))
  await started
  const handler = process.listeners("SIGTERM")
    .find((candidate) => !existingHandlers.has(candidate))
  assert.equal(typeof handler, "function")

  const signalEvidence = await handler()
  let caught
  try {
    await run
  } catch (error) {
    caught = error
  }

  assert.deepEqual(signalEvidence, {
    primaryCode: "notification_local_db_signal_received",
    cleanupCode: "notification_local_db_cleanup_deferred",
  })
  assert.equal(caught?.code, "notification_local_db_signal_received")
  assert.deepEqual(caught?.evidence, {
    primaryCode: "notification_local_db_signal_received",
    cleanupCode: "notification_local_db_cleanup_ok",
  })
  assert.equal(calls.filter(({ step }) => step === "cleanup").length, 1)
  assert.equal(calls.at(-1).step, "cleanup")
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`${signal}이 cleanup 도중 들어와도 passed로 반환하지 않는다`, async (t) => {
    const { manifest } = await buildRuntimeManifest(t)
    const calls = []
    const baseExecute = makeFakeExecutor(manifest, calls)
    let markCleanupStarted
    let releaseCleanup
    const cleanupStarted = new Promise((resolvePromise) => {
      markCleanupStarted = resolvePromise
    })
    const cleanupReleased = new Promise((resolvePromise) => {
      releaseCleanup = resolvePromise
    })
    const execute = async (invocation) => {
      if (invocation.step !== "cleanup") return baseExecute(invocation)
      calls.push(invocation)
      markCleanupStarted()
      await cleanupReleased
      return {
        code: 0,
        stdout: "",
        stderr: "",
        evidence: successfulStepEvidence(invocation.step, manifest),
      }
    }
    const existingHandlers = new Set(process.listeners(signal))
    const previousExitCode = process.exitCode
    t.after(() => { process.exitCode = previousExitCode })
    const { runNotificationIsolatedDbQa } = await loadSubject()
    const outcome = runNotificationIsolatedDbQa(orchestrationContext(manifest, execute))
      .then((value) => ({ value }), (error) => ({ error }))
    await cleanupStarted
    const handler = process.listeners(signal)
      .find((candidate) => !existingHandlers.has(candidate))
    assert.equal(typeof handler, "function")

    const signalEvidence = await handler()
    releaseCleanup()
    const { error, value } = await outcome

    assert.equal(value, undefined)
    assert.deepEqual(signalEvidence, {
      primaryCode: "notification_local_db_signal_received",
      cleanupCode: "notification_local_db_cleanup_deferred",
    })
    assert.equal(error?.code, "notification_local_db_signal_received")
    assert.deepEqual(error?.evidence, {
      primaryCode: "notification_local_db_signal_received",
      cleanupCode: "notification_local_db_cleanup_ok",
    })
    assert.equal(calls.filter(({ step }) => step === "cleanup").length, 1)
    assert.equal(calls.at(-1).step, "cleanup")
  })
}

test("CLI full flags는 외부 주입 없이 trusted default executor의 orchestrator만 호출한다", () => {
  const mainStart = runnerSource.indexOf("async function main()")
  const mainEnd = runnerSource.indexOf("if (fileURLToPath(import.meta.url)", mainStart)
  assert.ok(mainStart >= 0 && mainEnd > mainStart)
  const mainSource = runnerSource.slice(mainStart, mainEnd)
  const runStart = runnerSource.indexOf("export async function runNotificationIsolatedDbQa")
  const runEnd = runnerSource.indexOf("async function main()", runStart)
  assert.ok(runStart >= 0 && runEnd > runStart)
  const runSource = runnerSource.slice(runStart, runEnd)
  const prepareStart = runnerSource.indexOf("async function prepareNotificationLocalQaContext")
  const prepareEnd = runnerSource.indexOf("async function planEvidence", prepareStart)
  assert.ok(prepareStart >= 0 && prepareEnd > prepareStart)
  const prepareSource = runnerSource.slice(prepareStart, prepareEnd)
  const remoteRunStart = runnerSource.indexOf(
    "export async function runNotificationRemoteCollectorWithCleanup",
  )
  const remoteRunEnd = runnerSource.indexOf("function successfulLocalResult", remoteRunStart)
  assert.ok(remoteRunStart >= 0 && remoteRunEnd > remoteRunStart)
  const remoteRunSource = runnerSource.slice(remoteRunStart, remoteRunEnd)
  const versionStart = runnerSource.indexOf("async function verifyPinnedSupabaseCli")
  const versionEnd = runnerSource.indexOf("async function removeNotificationRuntimeRoot", versionStart)
  assert.ok(versionStart >= 0 && versionEnd > versionStart)
  const versionSource = runnerSource.slice(versionStart, versionEnd)
  const localQueryStart = runnerSource.indexOf("async function runLocalQueryFile")
  const localQueryEnd = runnerSource.indexOf("async function assertInternalNetwork", localQueryStart)
  assert.ok(localQueryStart >= 0 && localQueryEnd > localQueryStart)
  const localQuerySource = runnerSource.slice(localQueryStart, localQueryEnd)
  const collectorStart = runnerSource.indexOf("export async function collectRemoteSchemaMetadata")
  const collectorEnd = runnerSource.indexOf("export function assertLocalMutationTarget", collectorStart)
  assert.ok(collectorStart >= 0 && collectorEnd > collectorStart)
  const collectorSource = runnerSource.slice(collectorStart, collectorEnd)
  const remoteInvocationStart = runnerSource.indexOf(
    "export function buildNotificationRemoteDockerInvocation",
  )
  const remoteInvocationEnd = runnerSource.indexOf(
    "function assertNotificationRunNotAborted",
    remoteInvocationStart,
  )
  assert.ok(remoteInvocationStart >= 0 && remoteInvocationEnd > remoteInvocationStart)
  const remoteInvocationSource = runnerSource.slice(remoteInvocationStart, remoteInvocationEnd)

  assert.match(
    runnerSource,
    /async function executeNotificationLocalQaInvocation\s*\(/u,
  )
  assert.match(
    runnerSource,
    /context\.execute\s*\?\?\s*executeNotificationLocalQaInvocation/u,
  )
  assert.match(
    runnerSource,
    /import\(\s*["']\.\/notification-content-db-evidence\.mjs["']\s*\)/u,
  )
  assert.match(
    runnerSource,
    /const DEFAULT_SUPABASE_GO_CLI_PATH\s*=\s*[\s\S]{0,200}\/supabase-go["']/u,
  )
  assert.equal(
    runnerSource.split(expectedSupabaseGoCliPath).length - 1,
    1,
  )
  assert.doesNotMatch(runnerSource, /DEFAULT_SUPABASE_CLI_PATH/u)
  assert.doesNotMatch(
    runnerSource,
    /REMOTE_SAFE_ENV_KEYS|assertLinkedProject(?:Metadata|State)|buildRemoteEnvironment|buildRemoteInvocation/u,
  )
  assert.match(
    runnerSource,
    /runNotificationContentDbEvidence\(\{[\s\S]*?query\s*:/u,
  )
  assert.doesNotMatch(
    runnerSource,
    /command\s*:\s*process\.execPath[\s\S]{0,400}notification-content-db-evidence/u,
  )
  assert.match(
    mainSource,
    /await runNotificationIsolatedDbQa\(\{ approved: true \}\)/u,
  )
  assert.doesNotMatch(
    mainSource,
    /execute\s*:|runtimeManifest\s*:|fixtureContract\s*:|sourceEnvironment\s*:/u,
  )
  assert.doesNotMatch(
    runnerSource,
    /NOTIFICATION_(?:LOCAL_)?QA_(?:CONTEXT|EXECUTOR|MANIFEST)|JSON\.parse\(process\.env/u,
  )
  assert.ok(
    runSource.indexOf("installLocalQaSignalLifecycle")
      < runSource.indexOf("await prepareNotificationLocalQaContext"),
  )
  assert.match(runSource, /prepareNotificationLocalQaContext\(context,\s*\{\s*abortSignal:/u)
  assert.match(runnerSource, /sourceEnvironment: process\.env,\s*abortSignal,/u)
  assert.match(runnerSource, /process\.on\(signal, handlers\[signal\]\)/u)
  assert.match(versionSource, /command: DEFAULT_SUPABASE_GO_CLI_PATH/u)
  assert.match(localQuerySource, /command: DEFAULT_SUPABASE_GO_CLI_PATH/u)
  assert.match(
    prepareSource,
    /collectorContext:\s*\{\s*approved: true,\s*artifactRoot: tempRoot,\s*sourceEnvironment: process\.env,\s*abortSignal,/u,
  )
  assert.doesNotMatch(prepareSource, /cliPath:|linkedProjectMetadata:/u)
  assert.match(prepareSource, /execute: executeBoundedProcess/u)
  assert.match(prepareSource, /await runNotificationRemoteCollectorWithCleanup/u)
  assert.doesNotMatch(prepareSource, /local-db-start|buildNotificationLocalQaInvocation/u)
  assert.match(collectorSource, /buildNotificationRemoteDockerInvocation\("image-inspect"/u)
  assert.doesNotMatch(collectorSource, /--linked|db", "(?:query|dump)"/u)
  assert.doesNotMatch(
    remoteInvocationSource,
    /SUPABASE_(?:ACCESS_TOKEN|DB_PASSWORD)|PGPASSWORD|--linked|db", "(?:query|dump)"/u,
  )
  assert.ok(remoteRunSource.indexOf("await cleanupController.preflight(abortSignal)")
    < remoteRunSource.indexOf("remoteCollection = await collect"))
  assert.ok(remoteRunSource.indexOf("remoteCollection = await collect")
    < remoteRunSource.indexOf("await cleanupController.cleanup()"))
  assert.match(
    remoteRunSource,
    /\{ collectorRuntime: runtime \}/u,
  )
  assert.match(
    runnerSource,
    /child\.kill\(basename\(command\) === "supabase-go" \? "SIGINT" : "SIGTERM"\)/u,
  )
  assert.match(runnerSource, /child\.kill\("SIGKILL"\)/u)
})
