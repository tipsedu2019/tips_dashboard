import { fileURLToPath } from "node:url"

const PARENT_PROJECT_REF = "slnjqlzzhewblvttiidk"
const ALLOWED_REGION = "ap-northeast-2"
const MIGRATION_FILE_PATTERN = /^(\d{14})_([a-z0-9_]+)\.sql$/u
const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const LOCAL_DATABASE_HOSTS = new Set(["127.0.0.1", "localhost", "::1"])

function migrationDrift() {
  throw new Error("notification_local_db_migration_drift")
}

function normalizeLocalMigrationFiles(localFiles) {
  if (!Array.isArray(localFiles) || localFiles.length === 0) migrationDrift()

  const migrations = []
  let previousVersion = ""

  for (const value of localFiles) {
    const fileName = value?.fileName
    const relativePath = value?.relativePath
    const sha256 = value?.sha256
    const match = typeof fileName === "string"
      ? MIGRATION_FILE_PATTERN.exec(fileName)
      : null

    if (
      !match
      || relativePath !== `supabase/migrations/${fileName}`
      || typeof sha256 !== "string"
      || !SHA256_PATTERN.test(sha256)
    ) {
      migrationDrift()
    }

    const [, version, name] = match
    if (version <= previousVersion) migrationDrift()
    previousVersion = version

    migrations.push(Object.freeze({
      version,
      name,
      fileName,
      relativePath,
      sha256,
    }))
  }

  return Object.freeze(migrations)
}

export function assertLinkedProjectMetadata(value) {
  if (
    value?.project_ref !== PARENT_PROJECT_REF
    || value?.region !== ALLOWED_REGION
  ) {
    throw new Error("notification_local_db_project_metadata_refused")
  }

  return Object.freeze({
    projectRef: PARENT_PROJECT_REF,
    region: ALLOWED_REGION,
  })
}

export function normalizeRemoteMigrationVersions(payload, localFiles) {
  const rawMigrations = payload?.migrations
  const localMigrations = normalizeLocalMigrationFiles(localFiles)

  if (
    !Array.isArray(rawMigrations)
    || rawMigrations.length === 0
    || rawMigrations.length > localMigrations.length
  ) {
    migrationDrift()
  }

  const remoteMigrations = Array.from(rawMigrations, (value, index) => {
    const local = localMigrations[index]
    if (
      typeof value?.version !== "string"
      || typeof value?.name !== "string"
      || value.version !== local?.version
      || value.name !== local?.name
    ) {
      migrationDrift()
    }

    return Object.freeze({ version: value.version, name: value.name })
  })

  return Object.freeze(remoteMigrations)
}

export function derivePendingMigrationFiles(remoteMigrations, localFiles) {
  const local = normalizeLocalMigrationFiles(localFiles)
  const remote = normalizeRemoteMigrationVersions({ migrations: remoteMigrations }, localFiles)
  return Object.freeze(local.slice(remote.length))
}

export function assertLocalMutationTarget(value, expectedPort) {
  if (!Number.isInteger(expectedPort) || expectedPort < 1024 || expectedPort > 65535) {
    throw new Error("notification_local_db_mutation_target_refused")
  }

  let target
  try {
    target = new URL(value)
  } catch {
    throw new Error("notification_local_db_mutation_target_refused")
  }

  const hostname = target.hostname.startsWith("[") && target.hostname.endsWith("]")
    ? target.hostname.slice(1, -1)
    : target.hostname
  const valid = (target.protocol === "postgres:" || target.protocol === "postgresql:")
    && LOCAL_DATABASE_HOSTS.has(hostname)
    && Number(target.port) === expectedPort
    && target.username === "postgres"
    && target.password === "postgres"
    && target.pathname === "/postgres"
    && target.search === ""
    && target.hash === ""

  if (!valid) throw new Error("notification_local_db_mutation_target_refused")

  return Object.freeze({
    hostname,
    port: expectedPort,
    database: "postgres",
  })
}

export function redactCommandEvidence(value) {
  return String(value)
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/giu, "[redacted-postgres-url]")
    .replace(/\b(?:sbp|sb_secret|sb_publishable)_[A-Za-z0-9_-]+/gu, "[redacted-supabase-key]")
    .replace(
      /https:\/\/chat\.googleapis\.com\/[^\s"'<>]+/giu,
      "[redacted-google-chat-webhook]",
    )
}

function planEvidence() {
  return {
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
  }
}

export async function runNotificationIsolatedDbQa({ approved = false } = {}) {
  if (approved !== true) {
    throw new Error("notification_local_db_approval_required")
  }

  throw new Error("notification_local_db_runner_not_implemented")
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    process.stdout.write(`${JSON.stringify(planEvidence(), null, 2)}\n`)
    return
  }

  const approved = args.length === 2
    && args.includes("--execute")
    && args.includes("--approved-local-db")

  if (!approved) throw new Error("notification_local_db_approval_required")
  await runNotificationIsolatedDbQa({ approved: true })
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${redactCommandEvidence(error?.message ?? "notification_local_db_failed")}\n`)
    process.exitCode = 1
  })
}
