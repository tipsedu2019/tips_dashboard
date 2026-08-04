import { createHash } from "node:crypto"
import { constants as fileConstants } from "node:fs"
import {
  chmod,
  lstat,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const PARENT_PROJECT_REF = "slnjqlzzhewblvttiidk"
const ALLOWED_REGION = "ap-northeast-2"
const MIGRATION_FILE_PATTERN = /^(\d{14})_([a-z0-9_]+)\.sql$/u
const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const LOCAL_DATABASE_HOSTS = new Set(["127.0.0.1", "localhost", "::1"])
const REMOTE_SAFE_ENV_KEYS = Object.freeze([
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SUPABASE_ACCESS_TOKEN",
  "TMPDIR",
  "USER",
])
const REQUIRED_ROLES = Object.freeze([
  "anon",
  "authenticated",
  "authenticator",
  "postgres",
  "service_role",
  "supabase_admin",
])
const REQUIRED_SCHEMAS = Object.freeze([
  "auth",
  "dashboard_private",
  "extensions",
  "public",
  "supabase_migrations",
])
const REQUIRED_CATALOGS = Object.freeze([
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
const REMOTE_METADATA_ALIAS = "notification_local_qa_remote_metadata"
const REMOTE_METADATA_KEYS = Object.freeze([
  "catalogs",
  "extensions",
  "migrations",
  "roles",
  "schemas",
  "server_version_num",
  "transaction_read_only",
])
const MAX_METADATA_BYTES = 2 * 1024 * 1024
const MAX_SCHEMA_DUMP_BYTES = 256 * 1024 * 1024
const MAX_STATUS_STDOUT_BYTES = 64 * 1024
const MAX_STDERR_BYTES = 64 * 1024

const REMOTE_METADATA_SQL = `begin read only;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

select pg_catalog.jsonb_build_object(
  'transaction_read_only', pg_catalog.current_setting('transaction_read_only') = 'on',
  'server_version_num', pg_catalog.current_setting('server_version_num')::integer,
  'migrations', (
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('version', migration_row.version, 'name', migration_row.name)
        order by migration_row.version
      ),
      '[]'::jsonb
    )
    from supabase_migrations.schema_migrations migration_row
  ),
  'extensions', (
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('name', extension_row.extname, 'version', extension_row.extversion)
        order by extension_row.extname
      ),
      '[]'::jsonb
    )
    from pg_catalog.pg_extension extension_row
  ),
  'roles', pg_catalog.jsonb_build_object(
    'anon', exists(select 1 from pg_catalog.pg_roles where rolname = 'anon'),
    'authenticated', exists(select 1 from pg_catalog.pg_roles where rolname = 'authenticated'),
    'authenticator', exists(select 1 from pg_catalog.pg_roles where rolname = 'authenticator'),
    'postgres', exists(select 1 from pg_catalog.pg_roles where rolname = 'postgres'),
    'service_role', exists(select 1 from pg_catalog.pg_roles where rolname = 'service_role'),
    'supabase_admin', exists(select 1 from pg_catalog.pg_roles where rolname = 'supabase_admin')
  ),
  'schemas', pg_catalog.jsonb_build_object(
    'auth', exists(select 1 from pg_catalog.pg_namespace where nspname = 'auth'),
    'dashboard_private', exists(select 1 from pg_catalog.pg_namespace where nspname = 'dashboard_private'),
    'extensions', exists(select 1 from pg_catalog.pg_namespace where nspname = 'extensions'),
    'public', exists(select 1 from pg_catalog.pg_namespace where nspname = 'public'),
    'supabase_migrations', exists(select 1 from pg_catalog.pg_namespace where nspname = 'supabase_migrations')
  ),
  'catalogs', pg_catalog.jsonb_build_object(
    'auth_users', pg_catalog.to_regclass('auth.users') is not null,
    'classes', pg_catalog.to_regclass('public.classes') is not null,
    'dashboard_notifications', pg_catalog.to_regclass('public.dashboard_notifications') is not null,
    'google_chat_webhook_settings', pg_catalog.to_regclass('public.google_chat_webhook_settings') is not null,
    'migration_history', pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null,
    'notification_deliveries', pg_catalog.to_regclass('dashboard_private.notification_deliveries') is not null,
    'notification_rules', pg_catalog.to_regclass('dashboard_private.notification_rules') is not null,
    'notification_runtime_flags', pg_catalog.to_regclass('dashboard_private.notification_runtime_flags') is not null,
    'notification_settings_ui_registry', pg_catalog.to_regclass('dashboard_private.notification_settings_ui_registry') is not null,
    'notification_templates', pg_catalog.to_regclass('dashboard_private.notification_templates') is not null,
    'profiles', pg_catalog.to_regclass('public.profiles') is not null,
    'students', pg_catalog.to_regclass('public.students') is not null
  )
) as notification_local_qa_remote_metadata;
rollback;
`

function migrationDrift() {
  throw new Error("notification_local_db_migration_drift")
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isEnvironmentRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(value, expectedKeys) {
  return isPlainRecord(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expectedKeys].sort())
}

function isPathInside(parent, candidate) {
  const difference = relative(parent, candidate)
  return difference !== ""
    && difference !== ".."
    && !difference.startsWith(`..${sep}`)
    && !isAbsolute(difference)
}

function normalizeLocalMigrationFiles(localFiles) {
  if (!Array.isArray(localFiles) || localFiles.length === 0) migrationDrift()

  const migrations = []
  let previousVersion = ""

  for (const value of localFiles) {
    const fileName = value?.fileName
    const relativePath = value?.relativePath
    const sha256Value = value?.sha256
    const match = typeof fileName === "string"
      ? MIGRATION_FILE_PATTERN.exec(fileName)
      : null

    if (
      !match
      || relativePath !== `supabase/migrations/${fileName}`
      || typeof sha256Value !== "string"
      || !SHA256_PATTERN.test(sha256Value)
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
      sha256: sha256Value,
    }))
  }

  return Object.freeze(migrations)
}

async function resolveTrustedRepoRoot(repoRoot) {
  if (typeof repoRoot !== "string" || !isAbsolute(repoRoot)) migrationDrift()

  try {
    const requestedRoot = resolve(repoRoot)
    const rootStat = await lstat(requestedRoot)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) migrationDrift()
    return Object.freeze({
      requestedRoot,
      realRoot: await realpath(requestedRoot),
    })
  } catch (error) {
    if (error?.message === "notification_local_db_migration_drift") throw error
    migrationDrift()
  }
}

async function hashRegularMigrationFile(filePath, realMigrationsDir) {
  let fileHandle
  try {
    const entryStat = await lstat(filePath, { bigint: true })
    if (!entryStat.isFile() || entryStat.isSymbolicLink()) migrationDrift()

    const realFilePath = await realpath(filePath)
    if (!isPathInside(realMigrationsDir, realFilePath)) migrationDrift()

    fileHandle = await open(
      filePath,
      fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
    )
    const openedStat = await fileHandle.stat({ bigint: true })
    if (!openedStat.isFile() || !sameFileSnapshot(entryStat, openedStat)) migrationDrift()
    const contents = await fileHandle.readFile()
    const afterReadStat = await fileHandle.stat({ bigint: true })
    if (
      BigInt(contents.byteLength) !== openedStat.size
      || !sameFileSnapshot(openedStat, afterReadStat)
    ) {
      migrationDrift()
    }
    return sha256(contents)
  } catch (error) {
    if (error?.message === "notification_local_db_migration_drift") throw error
    migrationDrift()
  } finally {
    await fileHandle?.close().catch(() => {})
  }
}

function sameFileSnapshot(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
}

async function loadLocalMigrationCatalog(repoRoot) {
  try {
    const trustedRoot = await resolveTrustedRepoRoot(repoRoot)
    const supabaseDir = join(trustedRoot.requestedRoot, "supabase")
    const supabaseStat = await lstat(supabaseDir)
    if (!supabaseStat.isDirectory() || supabaseStat.isSymbolicLink()) migrationDrift()
    const realSupabaseDir = await realpath(supabaseDir)
    if (realSupabaseDir !== join(trustedRoot.realRoot, "supabase")) migrationDrift()

    const migrationsDir = join(supabaseDir, "migrations")
    const migrationsStat = await lstat(migrationsDir)
    if (!migrationsStat.isDirectory() || migrationsStat.isSymbolicLink()) migrationDrift()

    const realMigrationsDir = await realpath(migrationsDir)
    if (realMigrationsDir !== join(realSupabaseDir, "migrations")) migrationDrift()

    const entries = await readdir(migrationsDir, { withFileTypes: true })
    if (entries.length === 0) migrationDrift()
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)

    const descriptors = []
    for (const entry of entries) {
      if (!entry.isFile() || !MIGRATION_FILE_PATTERN.test(entry.name)) migrationDrift()
      const filePath = join(migrationsDir, entry.name)
      descriptors.push({
        fileName: entry.name,
        relativePath: `supabase/migrations/${entry.name}`,
        sha256: await hashRegularMigrationFile(filePath, realMigrationsDir),
      })
    }

    return Object.freeze({
      repoRoot: trustedRoot.requestedRoot,
      migrations: normalizeLocalMigrationFiles(descriptors),
    })
  } catch (error) {
    if (error?.message === "notification_local_db_migration_drift") throw error
    migrationDrift()
  }
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

function buildPendingFromCatalog(remote, localCatalog) {
  const applied = normalizeRemoteMigrationVersions(remote, localCatalog)
  const pending = localCatalog.slice(applied.length)
  const remoteMaximum = applied.at(-1)?.version
  if (!remoteMaximum || pending.some((migration) => migration.version <= remoteMaximum)) {
    migrationDrift()
  }
  return Object.freeze(pending)
}

export async function buildPendingMigrationManifest(remote, local) {
  const catalog = await loadLocalMigrationCatalog(local?.repoRoot)
  return buildPendingFromCatalog(remote, catalog.migrations)
}

function normalizeCollectedMigrations(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("notification_local_db_remote_metadata_invalid")
  }

  const migrations = []
  let previousVersion = ""
  for (const migration of value) {
    const version = migration?.version
    const name = migration?.name
    if (
      !hasExactKeys(migration, ["name", "version"])
      || typeof version !== "string"
      || !/^\d{14}$/u.test(version)
      || typeof name !== "string"
      || !/^[a-z0-9_]+$/u.test(name)
      || version <= previousVersion
    ) {
      throw new Error("notification_local_db_remote_metadata_invalid")
    }
    previousVersion = version
    migrations.push(Object.freeze({ version, name }))
  }
  return Object.freeze(migrations)
}

function normalizeCollectedExtensions(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("notification_local_db_remote_metadata_invalid")
  }

  const extensions = []
  let previousName = ""
  for (const extension of value) {
    const name = extension?.name
    const version = extension?.version
    if (
      !hasExactKeys(extension, ["name", "version"])
      || typeof name !== "string"
      || !/^[a-z][a-z0-9_-]*$/u.test(name)
      || typeof version !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9.+_-]*$/u.test(version)
      || name <= previousName
    ) {
      throw new Error("notification_local_db_remote_metadata_invalid")
    }
    previousName = name
    extensions.push(Object.freeze({ name, version }))
  }
  return Object.freeze(extensions)
}

function normalizeRequiredBooleanMap(value, expectedKeys) {
  if (!hasExactKeys(value, expectedKeys)) {
    throw new Error("notification_local_db_remote_metadata_invalid")
  }
  const normalized = {}
  for (const key of expectedKeys) {
    if (value[key] !== true) {
      throw new Error("notification_local_db_remote_metadata_invalid")
    }
    normalized[key] = true
  }
  return Object.freeze(normalized)
}

function parseRemoteMetadataOutput(stdout) {
  if (
    typeof stdout !== "string"
    || Buffer.byteLength(stdout) === 0
    || Buffer.byteLength(stdout) > MAX_METADATA_BYTES
  ) {
    throw new Error("notification_local_db_remote_metadata_invalid")
  }

  let rows
  try {
    rows = JSON.parse(stdout.trim())
  } catch {
    throw new Error("notification_local_db_remote_metadata_invalid")
  }

  if (
    !Array.isArray(rows)
    || rows.length !== 1
    || !hasExactKeys(rows[0], [REMOTE_METADATA_ALIAS])
  ) {
    throw new Error("notification_local_db_remote_metadata_invalid")
  }

  const raw = rows[0][REMOTE_METADATA_ALIAS]
  if (
    !hasExactKeys(raw, REMOTE_METADATA_KEYS)
    || raw.transaction_read_only !== true
    || !Number.isInteger(raw.server_version_num)
    || raw.server_version_num < 120000
    || raw.server_version_num > 999999
  ) {
    throw new Error("notification_local_db_remote_metadata_invalid")
  }

  const postgresMajor = Math.floor(raw.server_version_num / 10000)
  return deepFreeze({
    transactionReadOnly: true,
    serverVersionNum: raw.server_version_num,
    postgresMajor,
    migrations: normalizeCollectedMigrations(raw.migrations),
    extensions: normalizeCollectedExtensions(raw.extensions),
    roles: normalizeRequiredBooleanMap(raw.roles, REQUIRED_ROLES),
    schemas: normalizeRequiredBooleanMap(raw.schemas, REQUIRED_SCHEMAS),
    catalogs: normalizeRequiredBooleanMap(raw.catalogs, REQUIRED_CATALOGS),
  })
}

async function assertLinkedProjectState(repoRoot) {
  try {
    const linkedProjectPath = join(repoRoot, "supabase", ".temp", "linked-project.json")
    const linkedStat = await lstat(linkedProjectPath)
    if (!linkedStat.isFile() || linkedStat.isSymbolicLink() || linkedStat.size > 64 * 1024) {
      throw new Error("notification_local_db_linked_project_refused")
    }
    const linked = JSON.parse(await readFile(linkedProjectPath, "utf8"))
    if (!isPlainRecord(linked) || linked.ref !== PARENT_PROJECT_REF) {
      throw new Error("notification_local_db_linked_project_refused")
    }
  } catch (error) {
    if (error?.message === "notification_local_db_linked_project_refused") throw error
    throw new Error("notification_local_db_linked_project_refused")
  }
}

async function prepareArtifactRoot(artifactRoot) {
  if (typeof artifactRoot !== "string" || !isAbsolute(artifactRoot)) {
    throw new Error("notification_local_db_remote_artifact_refused")
  }

  try {
    const requestedRoot = resolve(artifactRoot)
    const rootStat = await lstat(requestedRoot)
    if (
      !rootStat.isDirectory()
      || rootStat.isSymbolicLink()
      || (rootStat.mode & 0o777) !== 0o700
      || (await readdir(requestedRoot)).length !== 0
    ) {
      throw new Error("notification_local_db_remote_artifact_refused")
    }

    const realRoot = await realpath(requestedRoot)
    const realTemporaryRoot = await realpath(tmpdir())
    if (!isPathInside(realTemporaryRoot, realRoot)) {
      throw new Error("notification_local_db_remote_artifact_refused")
    }
    return requestedRoot
  } catch (error) {
    if (error?.message === "notification_local_db_remote_artifact_refused") throw error
    throw new Error("notification_local_db_remote_artifact_refused")
  }
}

function buildRemoteEnvironment(sourceEnvironment, includeDatabasePassword) {
  const environment = {}
  for (const key of REMOTE_SAFE_ENV_KEYS) {
    if (typeof sourceEnvironment[key] === "string") environment[key] = sourceEnvironment[key]
  }
  if (includeDatabasePassword) {
    environment.SUPABASE_DB_PASSWORD = sourceEnvironment.SUPABASE_DB_PASSWORD
  }
  return Object.freeze(environment)
}

function buildRemoteInvocation({
  step,
  command,
  args,
  cwd,
  env,
  timeoutMs,
  maxStdoutBytes,
}) {
  return Object.freeze({
    step,
    command,
    args: Object.freeze(args),
    cwd,
    env,
    shell: false,
    stdin: "ignore",
    timeoutMs,
    maxStdoutBytes,
    maxStderrBytes: MAX_STDERR_BYTES,
  })
}

async function executeRemoteStep(invocation, execute, failureCode) {
  let result
  try {
    result = await execute(invocation)
  } catch {
    throw new Error(failureCode)
  }

  if (
    !isPlainRecord(result)
    || !Number.isInteger(result.code)
    || result.code !== 0
    || typeof result.stdout !== "string"
    || typeof result.stderr !== "string"
    || Buffer.byteLength(result.stdout) > invocation.maxStdoutBytes
    || Buffer.byteLength(result.stderr) > invocation.maxStderrBytes
  ) {
    throw new Error(failureCode)
  }
  return result.stdout
}

async function writePrivateFile(filePath, contents) {
  await writeFile(filePath, contents, { flag: "wx", mode: 0o600 })
  await chmod(filePath, 0o600)
  const fileStat = await lstat(filePath, { bigint: true })
  if (!fileStat.isFile() || fileStat.isSymbolicLink() || (fileStat.mode & 0o777n) !== 0o600n) {
    throw new Error("notification_local_db_remote_artifact_refused")
  }
  return Object.freeze({ dev: fileStat.dev, ino: fileStat.ino })
}

async function inspectQueryContract(queryPath, expectedIdentity) {
  let fileHandle
  try {
    fileHandle = await open(
      queryPath,
      fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
    )
    const fileStat = await fileHandle.stat({ bigint: true })
    const expectedBytes = Buffer.from(REMOTE_METADATA_SQL, "utf8")
    if (
      !fileStat.isFile()
      || fileStat.dev !== expectedIdentity?.dev
      || fileStat.ino !== expectedIdentity?.ino
      || fileStat.size !== BigInt(expectedBytes.byteLength)
      || (fileStat.mode & 0o777n) !== 0o600n
    ) {
      throw new Error("notification_local_db_remote_query_contract_refused")
    }

    const contents = await fileHandle.readFile()
    const afterReadStat = await fileHandle.stat({ bigint: true })
    if (
      !contents.equals(expectedBytes)
      || BigInt(contents.byteLength) !== fileStat.size
      || !sameFileSnapshot(fileStat, afterReadStat)
    ) {
      throw new Error("notification_local_db_remote_query_contract_refused")
    }

    return Object.freeze({ sha256: sha256(contents) })
  } catch (error) {
    if (error?.message === "notification_local_db_remote_query_contract_refused") throw error
    throw new Error("notification_local_db_remote_query_contract_refused")
  } finally {
    await fileHandle?.close().catch(() => {})
  }
}

async function inspectSchemaDump(schemaDumpPath, expectedIdentity) {
  let fileHandle
  try {
    fileHandle = await open(
      schemaDumpPath,
      fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
    )
    const openedStat = await fileHandle.stat({ bigint: true })
    if (
      !openedStat.isFile()
      || openedStat.dev !== expectedIdentity?.dev
      || openedStat.ino !== expectedIdentity?.ino
    ) {
      throw new Error("notification_local_db_remote_schema_dump_refused")
    }
    await fileHandle.chmod(0o600)
    const fileStat = await fileHandle.stat({ bigint: true })
    if (
      !fileStat.isFile()
      || fileStat.size === 0n
      || fileStat.size > BigInt(MAX_SCHEMA_DUMP_BYTES)
      || (fileStat.mode & 0o777n) !== 0o600n
    ) {
      throw new Error("notification_local_db_remote_schema_dump_refused")
    }

    const contents = await fileHandle.readFile()
    const afterReadStat = await fileHandle.stat({ bigint: true })
    if (
      BigInt(contents.byteLength) !== fileStat.size
      || !sameFileSnapshot(fileStat, afterReadStat)
    ) {
      throw new Error("notification_local_db_remote_schema_dump_refused")
    }
    const text = contents.toString("utf8")
    if (
      /^-- Data for Name:/mu.test(text)
      || /^COPY\s+.+\s+FROM\s+stdin;/imu.test(text)
      || /\bpostgres(?:ql)?:\/\/[^\s"'<>]+/iu.test(text)
      || /\b(?:sbp|sb_secret|sb_publishable)_[A-Za-z0-9_-]+/u.test(text)
      || /https:\/\/chat\.googleapis\.com\/[^\s"'<>]+/iu.test(text)
    ) {
      throw new Error("notification_local_db_remote_schema_dump_refused")
    }

    return Object.freeze({
      sha256: sha256(contents),
      bytes: contents.byteLength,
    })
  } catch (error) {
    if (error?.message === "notification_local_db_remote_schema_dump_refused") throw error
    throw new Error("notification_local_db_remote_schema_dump_refused")
  } finally {
    await fileHandle?.close().catch(() => {})
  }
}

async function cleanupCollectorArtifacts(paths) {
  let cleanupFailed = false
  for (const filePath of paths) {
    try {
      await rm(filePath, { force: true })
    } catch {
      cleanupFailed = true
    }
  }

  for (const filePath of paths) {
    try {
      await lstat(filePath)
      cleanupFailed = true
    } catch (error) {
      if (error?.code !== "ENOENT") cleanupFailed = true
    }
  }

  if (cleanupFailed) {
    throw new Error("notification_local_db_remote_artifact_cleanup_failed")
  }
}

function assertCatalogUnchanged(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) migrationDrift()
}

function buildMigrationManifest(remote, pending) {
  const core = {
    version: 1,
    applied: remote.migrations,
    pending,
  }
  return deepFreeze({
    ...core,
    sha256: sha256(JSON.stringify(core)),
  })
}

export async function collectRemoteSchemaMetadata(context, execute) {
  if (context?.approved !== true) {
    throw new Error("notification_local_db_approval_required")
  }
  if (typeof execute !== "function") {
    throw new Error("notification_local_db_remote_context_refused")
  }
  if (
    typeof context.cliPath !== "string"
    || !isAbsolute(context.cliPath)
    || basename(context.cliPath) !== "supabase"
    || !isEnvironmentRecord(context.sourceEnvironment)
    || Object.hasOwn(context, "repoRoot")
  ) {
    throw new Error("notification_local_db_remote_context_refused")
  }

  const project = assertLinkedProjectMetadata(context.linkedProjectMetadata)
  const databasePassword = context.sourceEnvironment.SUPABASE_DB_PASSWORD
  if (
    typeof databasePassword !== "string"
    || databasePassword.length === 0
    || databasePassword.includes("\0")
  ) {
    throw new Error("notification_local_db_remote_credential_required")
  }

  const localBefore = await loadLocalMigrationCatalog(ROOT)
  await assertLinkedProjectState(localBefore.repoRoot)
  const artifactRoot = await prepareArtifactRoot(context.artifactRoot)
  const queryPath = join(artifactRoot, "notification-remote-metadata.sql")
  const metadataPath = join(artifactRoot, "notification-remote-metadata.json")
  const schemaDumpPath = join(artifactRoot, "notification-remote-schema.sql")
  const collectorArtifacts = [queryPath, metadataPath, schemaDumpPath]
  const metadataEnvironment = buildRemoteEnvironment(context.sourceEnvironment, false)
  const dumpEnvironment = buildRemoteEnvironment(context.sourceEnvironment, true)

  try {
    const queryIdentity = await writePrivateFile(queryPath, REMOTE_METADATA_SQL)
    const schemaDumpIdentity = await writePrivateFile(schemaDumpPath, "")

    const metadataArgs = [
      "db", "query", "--linked",
      "--file", queryPath,
      "--output", "json",
    ]
    const dumpArgs = [
      "db", "dump", "--linked",
      "--schema", "public,dashboard_private",
      "--file", schemaDumpPath,
    ]

    await assertLinkedProjectState(localBefore.repoRoot)
    let queryContract = await inspectQueryContract(queryPath, queryIdentity)
    const metadataBeforeStdout = await executeRemoteStep(
      buildRemoteInvocation({
        step: "metadata-before",
        command: context.cliPath,
        args: metadataArgs,
        cwd: localBefore.repoRoot,
        env: metadataEnvironment,
        timeoutMs: 60 * 1000,
        maxStdoutBytes: MAX_METADATA_BYTES,
      }),
      execute,
      "notification_local_db_remote_metadata_query_failed",
    )
    queryContract = await inspectQueryContract(queryPath, queryIdentity)
    const metadataBefore = parseRemoteMetadataOutput(metadataBeforeStdout)
    buildPendingFromCatalog({ migrations: metadataBefore.migrations }, localBefore.migrations)

    await assertLinkedProjectState(localBefore.repoRoot)
    await executeRemoteStep(
      buildRemoteInvocation({
        step: "schema-dump",
        command: context.cliPath,
        args: dumpArgs,
        cwd: localBefore.repoRoot,
        env: dumpEnvironment,
        timeoutMs: 20 * 60 * 1000,
        maxStdoutBytes: MAX_STATUS_STDOUT_BYTES,
      }),
      execute,
      "notification_local_db_remote_schema_dump_failed",
    )
    const schemaDump = await inspectSchemaDump(schemaDumpPath, schemaDumpIdentity)

    await assertLinkedProjectState(localBefore.repoRoot)
    queryContract = await inspectQueryContract(queryPath, queryIdentity)
    const metadataAfterStdout = await executeRemoteStep(
      buildRemoteInvocation({
        step: "metadata-after",
        command: context.cliPath,
        args: metadataArgs,
        cwd: localBefore.repoRoot,
        env: metadataEnvironment,
        timeoutMs: 60 * 1000,
        maxStdoutBytes: MAX_METADATA_BYTES,
      }),
      execute,
      "notification_local_db_remote_metadata_query_failed",
    )
    queryContract = await inspectQueryContract(queryPath, queryIdentity)
    const metadataAfter = parseRemoteMetadataOutput(metadataAfterStdout)
    if (JSON.stringify(metadataBefore) !== JSON.stringify(metadataAfter)) {
      throw new Error("notification_local_db_remote_snapshot_changed")
    }

    await assertLinkedProjectState(localBefore.repoRoot)
    const localAfter = await loadLocalMigrationCatalog(localBefore.repoRoot)
    assertCatalogUnchanged(localBefore.migrations, localAfter.migrations)
    const pending = buildPendingFromCatalog(
      { migrations: metadataAfter.migrations },
      localAfter.migrations,
    )
    const migrationManifest = buildMigrationManifest(metadataAfter, pending)
    const metadataContents = `${JSON.stringify(metadataAfter, null, 2)}\n`
    await writePrivateFile(metadataPath, metadataContents)

    return deepFreeze({
      project,
      remote: metadataAfter,
      migrationManifest,
      artifacts: {
        queryPath,
        querySha256: queryContract.sha256,
        metadataPath,
        metadataSha256: sha256(metadataContents),
        schemaDumpPath,
        schemaDumpSha256: schemaDump.sha256,
        schemaDumpBytes: schemaDump.bytes,
      },
      safety: {
        rowDataCopied: 0,
        productionMutationCount: 0,
      },
    })
  } catch (error) {
    const primaryCode = typeof error?.message === "string"
      && /^notification_local_db_[a-z0-9_]+$/u.test(error.message)
      ? error.message
      : "notification_local_db_remote_collector_failed"
    try {
      await cleanupCollectorArtifacts(collectorArtifacts)
    } catch {
      throw new Error(`${primaryCode}:notification_local_db_remote_artifact_cleanup_failed`)
    }
    throw new Error(primaryCode)
  }
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
