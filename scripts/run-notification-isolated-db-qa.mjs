import { spawn } from "node:child_process"
import { createHash, randomBytes as secureRandomBytes } from "node:crypto"
import { constants as fileConstants } from "node:fs"
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const PARENT_PROJECT_REF = "slnjqlzzhewblvttiidk"
const ALLOWED_REGION = "ap-northeast-2"
const MIGRATION_FILE_PATTERN = /^(\d{14})_([a-z0-9_]+)\.sql$/u
const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const LOCAL_DATABASE_HOSTS = new Set(["127.0.0.1", "localhost", "::1"])
const DOCKER_LOOPBACK_BIND_OPTION =
  "com.docker.network.bridge.host_binding_ipv4=127.0.0.1"
const MINIMUM_DOCKER_SERVER_MAJOR = 28
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
const MAX_LOCAL_STDOUT_BYTES = 2 * 1024 * 1024
const LOCAL_PROJECT_PATTERN = /^tips_notification_db_qa_([a-f0-9]{12})$/u
const REMOTE_COLLECTOR_PROJECT_PATTERN = /^tips_notify_collector_qa_([a-f0-9]{12})$/u
const LOCAL_OWNERSHIP_LABEL_KEY = "com.tips.notification-local-db-qa.owner"
const DEFAULT_SUPABASE_GO_CLI_PATH =
  "/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go"
const PINNED_SUPABASE_CLI_VERSION = "2.103.0"
const DEFAULT_DOCKER_CLI_PATH = "/Users/hyunjun/.local/bin/docker"
const TRUSTED_PROCESS_EXECUTOR = Symbol("notificationLocalQaTrustedProcessExecutor")
const LOCAL_ENV_SOURCE_KEYS = Object.freeze([
  "LANG",
  "LC_ALL",
  "PATH",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TMPDIR",
  "USER",
])
const LOCAL_ORCHESTRATION_STEPS = Object.freeze([
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
const STEP_FAILURE_CODES = Object.freeze({
  "preexisting-resource-check": "notification_local_db_resource_check_failed",
  "internal-network-create": "notification_local_db_network_failed",
  "local-db-start": "notification_local_db_start_failed",
  "public-default-privileges": "notification_local_db_restore_failed",
  "schema-restore": "notification_local_db_restore_failed",
  "local-catalog-postflight": "notification_local_db_restore_failed",
  "remote-migration-repair": "notification_local_db_migration_failed",
  "pending-migrations-copy": "notification_local_db_migration_failed",
  "runtime-activation-scan": "notification_local_db_migration_failed",
  "local-migration-push": "notification_local_db_migration_failed",
  "synthetic-fixture-install": "notification_local_db_fixture_failed",
  "safety-preflight": "notification_local_db_safety_preflight_failed",
  "read-only-evidence": "notification_local_db_evidence_failed",
  "disposable-round-trip": "notification_local_db_evidence_failed",
  pgtap: "notification_local_db_pgtap_failed",
  "safety-postflight": "notification_local_db_safety_postflight_failed",
  cleanup: "notification_local_db_cleanup_failed",
})

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

const PUBLIC_DEFAULT_PRIVILEGES_SQL = `begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';
revoke create on schema public from public;
alter default privileges for role postgres in schema public revoke all on tables from public;
alter default privileges for role postgres in schema public revoke all on sequences from public;
alter default privileges for role postgres in schema public revoke all on functions from public;
commit;
`

const LOCAL_CATALOG_POSTFLIGHT_SQL = `begin read only;
set local statement_timeout = '30s';
select pg_catalog.jsonb_build_object(
  'roles_ok', not exists (
    select required_role.name
    from (values ('anon'), ('authenticated'), ('authenticator'), ('postgres'),
      ('service_role'), ('supabase_admin')) required_role(name)
    where not exists (
      select 1 from pg_catalog.pg_roles role_row where role_row.rolname = required_role.name
    )
  ),
  'schemas_ok', to_regnamespace('auth') is not null
    and to_regnamespace('dashboard_private') is not null
    and to_regnamespace('extensions') is not null
    and to_regnamespace('public') is not null
    and to_regnamespace('supabase_migrations') is not null,
  'extensions_ok', exists (
    select 1 from pg_catalog.pg_extension where extname = 'pgcrypto'
  ) and exists (
    select 1 from pg_catalog.pg_available_extensions where name = 'pgtap'
  ),
  'unexpected_owner_count', (
    select pg_catalog.count(*)
    from pg_catalog.pg_class relation_row
    join pg_catalog.pg_namespace schema_row on schema_row.oid = relation_row.relnamespace
    join pg_catalog.pg_roles owner_row on owner_row.oid = relation_row.relowner
    where schema_row.nspname in ('public', 'dashboard_private')
      and relation_row.relkind in ('r', 'p', 'S', 'v', 'm')
      and owner_row.rolname not in ('postgres', 'supabase_admin')
  ),
  'rls_relation_count', (
    select pg_catalog.count(*)
    from pg_catalog.pg_class relation_row
    join pg_catalog.pg_namespace schema_row on schema_row.oid = relation_row.relnamespace
    where schema_row.nspname in ('public', 'dashboard_private')
      and relation_row.relkind in ('r', 'p')
      and relation_row.relrowsecurity
  ),
  'rls_policy_count', (
    select pg_catalog.count(*)
    from pg_catalog.pg_policy policy_row
    join pg_catalog.pg_class relation_row on relation_row.oid = policy_row.polrelid
    join pg_catalog.pg_namespace schema_row on schema_row.oid = relation_row.relnamespace
    where schema_row.nspname in ('public', 'dashboard_private')
  ),
  'unexpected_public_create_grants', (
    select pg_catalog.count(*)
    from pg_catalog.aclexplode(coalesce(
      (select namespace_row.nspacl from pg_catalog.pg_namespace namespace_row
        where namespace_row.nspname = 'public'),
      '{}'::aclitem[]
    )) grant_row
    where grant_row.privilege_type = 'CREATE'
      and (
        grant_row.grantee = 0
        or not exists (
          select 1 from pg_catalog.pg_roles grantee_row
          where grantee_row.oid = grant_row.grantee
            and grantee_row.rolname in ('postgres', 'supabase_admin')
        )
      )
  )
) as notification_local_qa_catalog_postflight;
rollback;
`

const FIXTURE_POSTFLIGHT_SQL = `begin read only;
set local statement_timeout = '30s';
select pg_catalog.jsonb_build_object(
  'authUsers', (select pg_catalog.count(*) from auth.users),
  'profiles', (select pg_catalog.count(*) from public.profiles),
  'workflows', (select pg_catalog.count(distinct workflow_key)
    from dashboard_private.notification_settings_ui_registry),
  'eventKeys', (select pg_catalog.count(distinct (workflow_key, event_key))
    from dashboard_private.notification_settings_ui_registry),
  'settingsRegistry', (select pg_catalog.count(*)
    from dashboard_private.notification_settings_ui_registry),
  'rules', (select pg_catalog.count(*) from dashboard_private.notification_rules),
  'historicalTemplates', (select pg_catalog.count(*)
    from dashboard_private.notification_templates where content_contract_version is null),
  'vNextTemplates', (select pg_catalog.count(*)
    from dashboard_private.notification_templates where content_contract_version = '1'),
  'templates', (select pg_catalog.count(*) from dashboard_private.notification_templates),
  'contentContracts', (select pg_catalog.count(*)
    from dashboard_private.notification_rule_content_contracts),
  'complianceAudits', (select pg_catalog.count(*)
    from dashboard_private.notification_template_compliance_audits),
  'legacySettings', (select pg_catalog.count(*) from public.makeup_notification_settings),
  'importMetadata', (select pg_catalog.count(*)
    from dashboard_private.notification_settings_import_metadata),
  'runtimeFlags', (select pg_catalog.count(*)
    from dashboard_private.notification_runtime_flags),
  'reminderApplicability', (select pg_catalog.count(*)
    from dashboard_private.registration_appointment_reminder_applicability),
  'operationalRows',
    (select pg_catalog.count(*) from dashboard_private.notification_deliveries)
    + (select pg_catalog.count(*) from public.dashboard_notifications),
  'enabledDispatchFlags', (select pg_catalog.count(*)
    from dashboard_private.notification_runtime_flags where enabled),
  'connectionSecretRows', (select pg_catalog.count(*)
    from public.google_chat_webhook_settings
    where nullif(pg_catalog.btrim(webhook_url), '') is not null
      or webhook_url_ciphertext is not null)
) as notification_local_qa_fixture_postflight;
rollback;
`

const SAFETY_POSTFLIGHT_SQL = `begin;
set local statement_timeout = '30s';
create or replace function pg_temp.notification_local_qa_count_rows(relation_oid regclass)
returns bigint
language plpgsql
as $$
declare
  row_count bigint;
begin
  if relation_oid is null then
    return 0;
  end if;
  execute pg_catalog.format('select pg_catalog.count(*) from %s', relation_oid)
    into row_count;
  return row_count;
end;
$$;
select pg_catalog.jsonb_build_object(
  'workerProcesses', (select pg_catalog.count(*) from pg_catalog.pg_stat_activity
    where pid <> pg_catalog.pg_backend_pid()
      and (coalesce(backend_type, '') ~* '(notification|worker|cron)'
        or application_name ~* '(notification|worker|cron)'
        or coalesce(query, '') ~* '(notification.*dispatch|cron\\.schedule|net\\.http)')),
  'queueRows',
    (select pg_catalog.count(*) from dashboard_private.notification_deliveries)
    + (select pg_catalog.count(*) from public.dashboard_notifications),
  'enabledDispatchFlags', (select pg_catalog.count(*)
    from dashboard_private.notification_runtime_flags where enabled),
  'cronJobs', pg_temp.notification_local_qa_count_rows(pg_catalog.to_regclass('cron.job')),
  'pgNetQueuedRequests',
    pg_temp.notification_local_qa_count_rows(pg_catalog.to_regclass('net.http_request_queue'))
    + pg_temp.notification_local_qa_count_rows(pg_catalog.to_regclass('net._http_response')),
  'foreignServers', (select pg_catalog.count(*) from pg_catalog.pg_foreign_server),
  'workerHeartbeats', pg_temp.notification_local_qa_count_rows(
    pg_catalog.to_regclass('dashboard_private.notification_worker_heartbeats')
  ),
  'outboundExtensions', (select coalesce(pg_catalog.jsonb_agg(extname order by extname), '[]'::jsonb)
    from pg_catalog.pg_extension where extname in ('dblink', 'http', 'pg_cron', 'pg_net', 'postgres_fdw'))
) as notification_local_qa_safety;
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

function runtimeManifestRefused() {
  throw new Error("notification_local_db_runtime_manifest_refused")
}

function normalizeRuntimePendingMigrations(value) {
  if (!Array.isArray(value)) runtimeManifestRefused()
  const migrations = []
  let previousVersion = ""
  for (const entry of value) {
    const match = typeof entry?.fileName === "string"
      ? MIGRATION_FILE_PATTERN.exec(entry.fileName)
      : null
    if (
      !match
      || !hasExactKeys(entry, ["fileName", "name", "relativePath", "sha256", "version"])
      || entry.version !== match[1]
      || entry.name !== match[2]
      || entry.relativePath !== `supabase/migrations/${entry.fileName}`
      || !SHA256_PATTERN.test(entry.sha256)
      || entry.version <= previousVersion
    ) {
      runtimeManifestRefused()
    }
    previousVersion = entry.version
    migrations.push(Object.freeze({
      version: entry.version,
      name: entry.name,
      fileName: entry.fileName,
      relativePath: entry.relativePath,
      sha256: entry.sha256,
    }))
  }
  return Object.freeze(migrations)
}

function normalizeRuntimePgTap(value) {
  if (
    !hasExactKeys(value, ["fileCount", "files", "sha256"])
    || value.fileCount !== 10
    || !SHA256_PATTERN.test(value.sha256)
    || !Array.isArray(value.files)
    || value.files.length !== value.fileCount
  ) {
    runtimeManifestRefused()
  }
  const seen = new Set()
  const files = value.files.map((entry) => {
    if (
      !hasExactKeys(entry, ["relativePath", "sha256"])
      || !/^supabase\/tests\/notification_[a-z0-9_]+_test\.sql$/u.test(entry.relativePath)
      || !SHA256_PATTERN.test(entry.sha256)
      || seen.has(entry.relativePath)
    ) {
      runtimeManifestRefused()
    }
    seen.add(entry.relativePath)
    return Object.freeze({ relativePath: entry.relativePath, sha256: entry.sha256 })
  })
  return Object.freeze({ fileCount: 10, files: Object.freeze(files), sha256: value.sha256 })
}

function runtimeManifestCore(value) {
  return {
    version: value.version,
    projectId: value.projectId,
    tempRoot: value.tempRoot,
    database: value.database,
    dockerNetwork: value.dockerNetwork,
    migrationCatalog: value.migrationCatalog,
    pendingMigrations: value.pendingMigrations,
    ownership: value.ownership,
    fixture: value.fixture,
    pgTap: value.pgTap,
  }
}

export function assertNotificationLocalRuntimeManifest(value) {
  if (
    !hasExactKeys(value, [
      "database",
      "dockerNetwork",
      "fixture",
      "migrationCatalog",
      "ownership",
      "pendingMigrations",
      "pgTap",
      "projectId",
      "sha256",
      "tempRoot",
      "version",
    ])
    || value.version !== 1
    || !LOCAL_PROJECT_PATTERN.test(value.projectId)
    || typeof value.tempRoot !== "string"
    || !isAbsolute(value.tempRoot)
    || resolve(value.tempRoot) !== value.tempRoot
    || !isPathInside(resolve(tmpdir()), value.tempRoot)
  ) {
    runtimeManifestRefused()
  }

  const expectedDatabaseUrl = `postgresql://postgres:postgres@127.0.0.1:${value.database?.port}/postgres`
  if (
    !hasExactKeys(value.database, ["database", "host", "port", "url"])
    || value.database.host !== "127.0.0.1"
    || !Number.isInteger(value.database.port)
    || value.database.port < 49152
    || value.database.port > 65535
    || value.database.database !== "postgres"
    || value.database.url !== expectedDatabaseUrl
  ) {
    runtimeManifestRefused()
  }
  assertLocalMutationTarget(value.database.url, value.database.port)

  const suffix = LOCAL_PROJECT_PATTERN.exec(value.projectId)?.[1]
  const expectedNetwork = `${value.projectId}_internal`
  if (
    !suffix
    || !hasExactKeys(value.dockerNetwork, [
      "driver",
      "hostBindingIpv4",
      "internal",
      "minimumServerMajor",
      "name",
    ])
    || value.dockerNetwork.name !== expectedNetwork
    || value.dockerNetwork.driver !== "bridge"
    || value.dockerNetwork.hostBindingIpv4 !== "127.0.0.1"
    || value.dockerNetwork.internal !== true
    || value.dockerNetwork.minimumServerMajor !== MINIMUM_DOCKER_SERVER_MAJOR
  ) {
    runtimeManifestRefused()
  }

  const expectedContainer = `supabase_db_${value.projectId}`
  const expectedVolume = `supabase_db_${value.projectId}`
  if (
    !hasExactKeys(value.ownership, ["containers", "label", "networks", "volumes"])
    || !hasExactKeys(value.ownership.label, ["key", "value"])
    || value.ownership.label.key !== LOCAL_OWNERSHIP_LABEL_KEY
    || value.ownership.label.value !== value.projectId
    || JSON.stringify(value.ownership.containers) !== JSON.stringify([expectedContainer])
    || JSON.stringify(value.ownership.volumes) !== JSON.stringify([expectedVolume])
    || JSON.stringify(value.ownership.networks) !== JSON.stringify([expectedNetwork])
  ) {
    runtimeManifestRefused()
  }

  const migrationCatalog = normalizeRuntimePendingMigrations(value.migrationCatalog)
  const pendingMigrations = normalizeRuntimePendingMigrations(value.pendingMigrations)
  if (
    migrationCatalog.length === 0
    || pendingMigrations.length > migrationCatalog.length
    || JSON.stringify(pendingMigrations) !== JSON.stringify(
      migrationCatalog.slice(migrationCatalog.length - pendingMigrations.length),
    )
  ) runtimeManifestRefused()
  if (
    !hasExactKeys(value.fixture, ["relativePath", "sha256", "sqlSha256"])
    || value.fixture.relativePath
      !== "supabase/tests/fixtures/notification_content_local_qa_fixture.sql"
    || !SHA256_PATTERN.test(value.fixture.sha256)
    || value.fixture.sqlSha256 !== value.fixture.sha256
  ) {
    runtimeManifestRefused()
  }
  const pgTap = normalizeRuntimePgTap(value.pgTap)

  const normalized = deepFreeze({
    version: 1,
    projectId: value.projectId,
    tempRoot: value.tempRoot,
    database: {
      host: "127.0.0.1",
      port: value.database.port,
      database: "postgres",
      url: expectedDatabaseUrl,
    },
    dockerNetwork: {
      name: expectedNetwork,
      driver: "bridge",
      hostBindingIpv4: "127.0.0.1",
      internal: true,
      minimumServerMajor: MINIMUM_DOCKER_SERVER_MAJOR,
    },
    migrationCatalog,
    pendingMigrations,
    ownership: {
      label: { key: LOCAL_OWNERSHIP_LABEL_KEY, value: value.projectId },
      containers: [expectedContainer],
      volumes: [expectedVolume],
      networks: [expectedNetwork],
    },
    fixture: {
      relativePath: value.fixture.relativePath,
      sha256: value.fixture.sha256,
      sqlSha256: value.fixture.sqlSha256,
    },
    pgTap,
  })
  const expectedSha256 = sha256(JSON.stringify(runtimeManifestCore(normalized)))
  if (value.sha256 !== expectedSha256) runtimeManifestRefused()
  return value
}

export async function buildNotificationLocalRuntimeManifest({
  randomBytes = secureRandomBytes,
  allocateLoopbackPort = allocateFreeLoopbackPort,
  tempRoot,
  migrationCatalog,
  pendingMigrations,
  fixtureContract,
} = {}) {
  if (typeof randomBytes !== "function" || typeof allocateLoopbackPort !== "function") {
    runtimeManifestRefused()
  }
  try {
    const rootStat = await lstat(tempRoot)
    const realTemporaryRoot = await realpath(tmpdir())
    const realRuntimeRoot = await realpath(tempRoot)
    if (
      !rootStat.isDirectory()
      || rootStat.isSymbolicLink()
      || (rootStat.mode & 0o777) !== 0o700
      || !isPathInside(realTemporaryRoot, realRuntimeRoot)
    ) runtimeManifestRefused()
  } catch (error) {
    if (error?.message === "notification_local_db_runtime_manifest_refused") throw error
    runtimeManifestRefused()
  }
  let randomValue
  let port
  try {
    randomValue = randomBytes(6)
    port = await allocateLoopbackPort("127.0.0.1")
  } catch {
    runtimeManifestRefused()
  }
  if (!(randomValue instanceof Uint8Array) || randomValue.byteLength !== 6) {
    runtimeManifestRefused()
  }

  const suffix = Buffer.from(randomValue).toString("hex")
  const projectId = `tips_notification_db_qa_${suffix}`
  const networkName = `${projectId}_internal`
  const normalizedCatalog = normalizeRuntimePendingMigrations(migrationCatalog)
  const normalizedPending = normalizeRuntimePendingMigrations(pendingMigrations)
  if (
    normalizedCatalog.length === 0
    || normalizedPending.length > normalizedCatalog.length
    || JSON.stringify(normalizedPending) !== JSON.stringify(
      normalizedCatalog.slice(normalizedCatalog.length - normalizedPending.length),
    )
  ) runtimeManifestRefused()
  const fixture = fixtureContract?.fixture
  const pgTap = fixtureContract?.pgTap
  if (
    fixture?.relativePath !== "supabase/tests/fixtures/notification_content_local_qa_fixture.sql"
    || !SHA256_PATTERN.test(fixture?.sha256)
    || fixtureContract?.manifest?.sqlSha256 !== fixture.sha256
  ) {
    runtimeManifestRefused()
  }

  const core = deepFreeze({
    version: 1,
    projectId,
    tempRoot,
    database: {
      host: "127.0.0.1",
      port,
      database: "postgres",
      url: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
    },
    dockerNetwork: {
      name: networkName,
      driver: "bridge",
      hostBindingIpv4: "127.0.0.1",
      internal: true,
      minimumServerMajor: MINIMUM_DOCKER_SERVER_MAJOR,
    },
    migrationCatalog: normalizedCatalog,
    pendingMigrations: normalizedPending,
    ownership: {
      label: { key: LOCAL_OWNERSHIP_LABEL_KEY, value: projectId },
      containers: [`supabase_db_${projectId}`],
      volumes: [`supabase_db_${projectId}`],
      networks: [networkName],
    },
    fixture: {
      relativePath: fixture.relativePath,
      sha256: fixture.sha256,
      sqlSha256: fixture.sha256,
    },
    pgTap: normalizeRuntimePgTap({
      fileCount: pgTap?.fileCount,
      sha256: pgTap?.sha256,
      files: pgTap?.files?.map(({ relativePath, sha256: hash }) => ({
        relativePath,
        sha256: hash,
      })),
    }),
  })
  const manifest = deepFreeze({ ...core, sha256: sha256(JSON.stringify(core)) })
  assertNotificationLocalRuntimeManifest(manifest)
  return manifest
}

export function buildNotificationQaChildEnvironments({
  sourceEnvironment,
  runtimeManifest,
} = {}) {
  const manifest = assertNotificationLocalRuntimeManifest(runtimeManifest)
  if (!isEnvironmentRecord(sourceEnvironment)) runtimeManifestRefused()

  const remoteBase = {}
  for (const key of REMOTE_SAFE_ENV_KEYS) {
    if (typeof sourceEnvironment[key] === "string") remoteBase[key] = sourceEnvironment[key]
  }
  const remoteMetadata = { ...remoteBase }
  delete remoteMetadata.SUPABASE_DB_PASSWORD
  const remoteSchema = { ...remoteBase }
  if (typeof sourceEnvironment.SUPABASE_DB_PASSWORD === "string") {
    remoteSchema.SUPABASE_DB_PASSWORD = sourceEnvironment.SUPABASE_DB_PASSWORD
  }

  const local = {}
  for (const key of LOCAL_ENV_SOURCE_KEYS) {
    if (typeof sourceEnvironment[key] === "string") local[key] = sourceEnvironment[key]
  }
  Object.assign(local, {
    HOME: join(manifest.tempRoot, "home"),
    XDG_CACHE_HOME: join(manifest.tempRoot, "home", ".cache"),
    XDG_CONFIG_HOME: join(manifest.tempRoot, "home", ".config"),
    SUPABASE_TELEMETRY_DISABLED: "true",
    PGHOST: manifest.database.host,
    PGPORT: String(manifest.database.port),
    PGDATABASE: manifest.database.database,
    PGUSER: "postgres",
    PGPASSWORD: "postgres",
    SUPABASE_PROJECT_ID: manifest.projectId,
    DOCKER_NETWORK_NAME: manifest.dockerNetwork.name,
    NOTIFICATION_CONTENT_DB_SCOPE: "local",
  })

  return deepFreeze({ remoteMetadata, remoteSchema, local })
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

async function prepareArtifactRoot(artifactRoot, expectedEntries = []) {
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
      || JSON.stringify((await readdir(requestedRoot)).sort())
        !== JSON.stringify([...expectedEntries].sort())
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

export async function buildNotificationRemoteCollectorRuntime({
  tempRoot,
  randomBytes = secureRandomBytes,
} = {}) {
  try {
    const rootStat = await lstat(tempRoot)
    const realTemporaryRoot = await realpath(tmpdir())
    const realRoot = await realpath(tempRoot)
    if (
      typeof randomBytes !== "function"
      || !rootStat.isDirectory()
      || rootStat.isSymbolicLink()
      || (rootStat.mode & 0o777) !== 0o700
      || !isPathInside(realTemporaryRoot, realRoot)
    ) throw new Error("notification_local_db_remote_runtime_refused")
    const randomValue = randomBytes(6)
    if (!(randomValue instanceof Uint8Array) || randomValue.byteLength !== 6) {
      throw new Error("notification_local_db_remote_runtime_refused")
    }
    const projectId = `tips_notify_collector_qa_${Buffer.from(randomValue).toString("hex")}`
    if (!REMOTE_COLLECTOR_PROJECT_PATTERN.test(projectId)) {
      throw new Error("notification_local_db_remote_runtime_refused")
    }
    const workdir = join(tempRoot, "remote-collector")
    const supabaseDir = join(workdir, "supabase")
    const linkedDir = join(supabaseDir, ".temp")
    await mkdir(workdir, { mode: 0o700 })
    await mkdir(supabaseDir, { mode: 0o700 })
    await mkdir(linkedDir, { mode: 0o700 })
    await writePrivateFile(
      join(supabaseDir, "config.toml"),
      `project_id = "${projectId}"\n`,
    )
    await writePrivateFile(join(linkedDir, "project-ref"), `${PARENT_PROJECT_REF}\n`)
    return deepFreeze({
      version: 1,
      projectId,
      tempRoot,
      workdir,
      label: { key: "com.supabase.cli.project", value: projectId },
    })
  } catch (error) {
    if (error?.message === "notification_local_db_remote_runtime_refused") throw error
    throw new Error("notification_local_db_remote_runtime_refused")
  }
}

function assertNotificationRemoteCollectorRuntime(value) {
  if (
    !hasExactKeys(value, ["label", "projectId", "tempRoot", "version", "workdir"])
    || value.version !== 1
    || !REMOTE_COLLECTOR_PROJECT_PATTERN.test(value.projectId ?? "")
    || value.workdir !== join(value.tempRoot, "remote-collector")
    || !hasExactKeys(value.label, ["key", "value"])
    || value.label.key !== "com.supabase.cli.project"
    || value.label.value !== value.projectId
  ) throw new Error("notification_local_db_remote_runtime_refused")
  return value
}

async function assertNotificationRemoteCollectorWorkdir(runtime, artifactRoot) {
  try {
    const value = assertNotificationRemoteCollectorRuntime(runtime)
    if (value.tempRoot !== artifactRoot) {
      throw new Error("notification_local_db_remote_runtime_refused")
    }
    for (const directory of [
      value.workdir,
      join(value.workdir, "supabase"),
      join(value.workdir, "supabase", ".temp"),
    ]) {
      const stat = await lstat(directory)
      if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700) {
        throw new Error("notification_local_db_remote_runtime_refused")
      }
    }
    const expectedFiles = [
      [join(value.workdir, "supabase", "config.toml"), `project_id = "${value.projectId}"\n`],
      [join(value.workdir, "supabase", ".temp", "project-ref"), `${PARENT_PROJECT_REF}\n`],
    ]
    for (const [filePath, expected] of expectedFiles) {
      const stat = await lstat(filePath)
      if (
        !stat.isFile()
        || stat.isSymbolicLink()
        || (stat.mode & 0o777) !== 0o600
        || await readFile(filePath, "utf8") !== expected
      ) throw new Error("notification_local_db_remote_runtime_refused")
    }
    return value.workdir
  } catch (error) {
    if (error?.message === "notification_local_db_remote_runtime_refused") throw error
    throw new Error("notification_local_db_remote_runtime_refused")
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
  abortSignal,
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
    ...(abortSignal instanceof AbortSignal ? { abortSignal } : {}),
  })
}

function assertNotificationRunNotAborted(abortSignal) {
  if (abortSignal instanceof AbortSignal && abortSignal.aborted) {
    throw new Error("notification_local_db_signal_received")
  }
}

async function executeRemoteStep(invocation, execute, failureCode) {
  assertNotificationRunNotAborted(invocation.abortSignal)
  let result
  try {
    result = await execute(invocation)
  } catch {
    assertNotificationRunNotAborted(invocation.abortSignal)
    throw new Error(failureCode)
  }
  assertNotificationRunNotAborted(invocation.abortSignal)

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

function buildMigrationManifest(remote, catalog, pending) {
  const core = {
    version: 2,
    applied: remote.migrations,
    catalog,
    pending,
  }
  return deepFreeze({
    ...core,
    sha256: sha256(JSON.stringify(core)),
  })
}

export async function collectRemoteSchemaMetadata(context, execute, { collectorRuntime } = {}) {
  if (context?.approved !== true) {
    throw new Error("notification_local_db_approval_required")
  }
  if (typeof execute !== "function") {
    throw new Error("notification_local_db_remote_context_refused")
  }
  if (execute === executeBoundedProcess && collectorRuntime === undefined) {
    throw new Error("notification_local_db_remote_runtime_refused")
  }
  if (
    typeof context.cliPath !== "string"
    || !isAbsolute(context.cliPath)
    || basename(context.cliPath) !== "supabase-go"
    || !isEnvironmentRecord(context.sourceEnvironment)
    || (context.abortSignal !== undefined && !(context.abortSignal instanceof AbortSignal))
    || Object.hasOwn(context, "repoRoot")
  ) {
    throw new Error("notification_local_db_remote_context_refused")
  }

  const project = assertLinkedProjectMetadata(context.linkedProjectMetadata)
  assertNotificationRunNotAborted(context.abortSignal)
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
  const normalizedCollectorRuntime = collectorRuntime === undefined
    ? undefined
    : assertNotificationRemoteCollectorRuntime(collectorRuntime)
  const artifactRoot = await prepareArtifactRoot(
    context.artifactRoot,
    normalizedCollectorRuntime ? [basename(normalizedCollectorRuntime.workdir)] : [],
  )
  const cliWorkdir = normalizedCollectorRuntime === undefined
    ? localBefore.repoRoot
    : await assertNotificationRemoteCollectorWorkdir(normalizedCollectorRuntime, artifactRoot)
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
        cwd: cliWorkdir,
        env: metadataEnvironment,
        timeoutMs: 60 * 1000,
        maxStdoutBytes: MAX_METADATA_BYTES,
        abortSignal: context.abortSignal,
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
        cwd: cliWorkdir,
        env: dumpEnvironment,
        timeoutMs: 20 * 60 * 1000,
        maxStdoutBytes: MAX_STATUS_STDOUT_BYTES,
        abortSignal: context.abortSignal,
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
        cwd: cliWorkdir,
        env: metadataEnvironment,
        timeoutMs: 60 * 1000,
        maxStdoutBytes: MAX_METADATA_BYTES,
        abortSignal: context.abortSignal,
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
    const migrationManifest = buildMigrationManifest(metadataAfter, localAfter.migrations, pending)
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

function safeFailureCode(value, fallback) {
  return typeof value === "string" && /^notification_local_db_[a-z0-9_]+$/u.test(value)
    ? value
    : fallback
}

class NotificationLocalDbQaError extends Error {
  constructor(primaryCode, cleanupCode = "notification_local_db_cleanup_not_required") {
    const code = safeFailureCode(primaryCode, "notification_local_db_failed")
    super(code)
    this.name = "NotificationLocalDbQaError"
    this.code = code
    this.evidence = deepFreeze({ primaryCode: code, cleanupCode })
  }
}

async function allocateFreeLoopbackPort(host = "127.0.0.1") {
  if (host !== "127.0.0.1") runtimeManifestRefused()
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer()
    let settled = false
    const fail = () => {
      if (settled) return
      settled = true
      rejectPromise(new Error("notification_local_db_port_allocation_failed"))
    }
    server.unref()
    server.once("error", fail)
    server.listen({ host, port: 0, exclusive: true }, () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      server.close((error) => {
        if (settled) return
        settled = true
        if (error || !Number.isInteger(port)) {
          rejectPromise(new Error("notification_local_db_port_allocation_failed"))
          return
        }
        resolvePromise(port)
      })
    })
  })
}

export function buildNotificationLocalQaInvocation(step, {
  runtimeManifest,
  localEnvironment,
  state,
  sql,
  executionContract,
  abortSignal,
} = {}) {
  const manifest = assertNotificationLocalRuntimeManifest(runtimeManifest)
  if (!LOCAL_ORCHESTRATION_STEPS.includes(step) || !isEnvironmentRecord(localEnvironment)) {
    throw new Error("notification_local_db_invocation_refused")
  }
  const label = `${manifest.ownership.label.key}=${manifest.ownership.label.value}`
  let command = DEFAULT_SUPABASE_GO_CLI_PATH
  let args

  switch (step) {
    case "preexisting-resource-check":
      command = "docker"
      args = ["ps", "-aq", "--filter", `label=${label}`]
      break
    case "internal-network-create":
      command = "docker"
      args = [
        "network", "create", "--driver", "bridge", "--internal",
        "--opt", DOCKER_LOOPBACK_BIND_OPTION,
        "--label", label,
        "--label", `com.supabase.cli.project=${manifest.projectId}`,
        manifest.dockerNetwork.name,
      ]
      break
    case "local-db-start":
      if (!/^[a-f0-9]{64}$/u.test(state?.dockerNetworkId ?? "")) {
        throw new Error("notification_local_db_invocation_refused")
      }
      args = [
        "db", "start",
        "--workdir", manifest.tempRoot,
        "--network-id", manifest.dockerNetwork.name,
      ]
      break
    case "public-default-privileges":
      args = [
        "db", "query", "--db-url", manifest.database.url,
        "--file", join(manifest.tempRoot, "public-default-privileges.sql"),
      ]
      break
    case "schema-restore":
      args = [
        "db", "query", "--db-url", manifest.database.url,
        "--file", join(manifest.tempRoot, "notification-remote-schema.sql"),
      ]
      break
    case "local-catalog-postflight":
      args = [
        "db", "query", "--db-url", manifest.database.url,
        "--file", join(manifest.tempRoot, "local-catalog-postflight.sql"),
        "--output", "json",
      ]
      break
    case "remote-migration-repair":
      args = [
        "migration", "repair",
        ...(executionContract?.appliedMigrations ?? []).map((entry) => entry.version),
        "--local", "--status", "applied", "--workdir", manifest.tempRoot,
      ]
      break
    case "pending-migrations-copy":
      command = process.execPath
      args = ["notification-local-internal", "copy-pending-migrations"]
      break
    case "runtime-activation-scan":
      command = process.execPath
      args = ["notification-local-internal", "scan-pending-migrations"]
      break
    case "local-migration-push":
      args = ["db", "push", "--local", "--dry-run", "--workdir", manifest.tempRoot]
      break
    case "synthetic-fixture-install":
      args = [
        "db", "query", "--db-url", manifest.database.url,
        "--file", resolve(ROOT, manifest.fixture.relativePath),
      ]
      break
    case "safety-preflight":
    case "safety-postflight":
      args = [
        "db", "query", "--db-url", manifest.database.url,
        "--file", join(manifest.tempRoot, "local-safety-postflight.sql"),
        "--output", "json",
      ]
      break
    case "read-only-evidence":
    case "disposable-round-trip":
      args = ["db", "query", "--db-url", manifest.database.url, "--output", "json"]
      break
    case "pgtap":
      if (!/^[a-f0-9]{64}$/u.test(state?.dockerNetworkId ?? "")) {
        throw new Error("notification_local_db_invocation_refused")
      }
      args = [
        "test", "db", "--local",
        "--workdir", manifest.tempRoot,
        "--network-id", manifest.dockerNetwork.name,
        ...manifest.pgTap.files.map((entry) => resolve(manifest.tempRoot, entry.relativePath)),
      ]
      break
    case "cleanup":
      args = ["stop", "--project-id", manifest.projectId, "--no-backup", "--workdir", manifest.tempRoot]
      break
    default:
      throw new Error("notification_local_db_invocation_refused")
  }

  return Object.freeze({
    step,
    command,
    args: Object.freeze(args),
    cwd: manifest.tempRoot,
    env: localEnvironment,
    state: Object.freeze({
      localStartAttempted: state?.localStartAttempted === true,
      signalReceived: state?.signalReceived === true,
      ...(typeof state?.dockerNetworkId === "string"
        ? { dockerNetworkId: state.dockerNetworkId }
        : {}),
    }),
    ...(typeof sql === "string" ? { sql } : {}),
    ...(isPlainRecord(executionContract) ? { executionContract } : {}),
    ...(abortSignal instanceof AbortSignal ? { abortSignal } : {}),
    runtimeManifest: manifest,
    timeoutMs: step === "cleanup" ? 2 * 60 * 1000 : 20 * 60 * 1000,
    maxStdoutBytes: MAX_LOCAL_STDOUT_BYTES,
    maxStderrBytes: MAX_STDERR_BYTES,
  })
}

function normalizeInvocationResult(result, failureCode) {
  if (
    !isPlainRecord(result)
    || result.code !== 0
    || typeof result.stdout !== "string"
    || typeof result.stderr !== "string"
    || Buffer.byteLength(result.stdout) > MAX_LOCAL_STDOUT_BYTES
    || Buffer.byteLength(result.stderr) > MAX_STDERR_BYTES
    || !isPlainRecord(result.evidence)
  ) {
    throw new Error(failureCode)
  }
  return result.evidence
}

function assertZeroSafetyEvidence(value, failureCode) {
  if (
    !isPlainRecord(value)
    || value.egressBlocked !== true
    || value.workerProcesses !== 0
    || value.queueRows !== 0
    || value.enabledDispatchFlags !== 0
  ) {
    throw new Error(failureCode)
  }
  return value
}

function assertFixtureStepEvidence(value, fixtureContract) {
  const expectedCounts = fixtureContract?.manifest?.expectedCounts
  if (
    !isPlainRecord(value)
    || value.fixtureSqlSha256 !== fixtureContract?.fixture?.sha256
    || !isPlainRecord(value.counts)
    || JSON.stringify(value.counts) !== JSON.stringify(expectedCounts)
  ) {
    throw new Error("notification_local_db_fixture_failed")
  }
  return value
}

function assertPgTapStepEvidence(value, runtimeManifest) {
  if (
    !isPlainRecord(value)
    || value.fileCount !== runtimeManifest.pgTap.fileCount
    || value.passed !== runtimeManifest.pgTap.fileCount
    || value.failed !== 0
    || JSON.stringify(value.files)
      !== JSON.stringify(runtimeManifest.pgTap.files.map((entry) => entry.relativePath))
  ) {
    throw new Error("notification_local_db_pgtap_failed")
  }
  return value
}

function assertCleanupEvidence(value) {
  if (
    !isPlainRecord(value)
    || value.ownedResourcesRemaining !== 0
    || value.containersRemaining !== 0
    || value.volumesRemaining !== 0
    || value.networksRemaining !== 0
  ) {
    throw new Error("notification_local_db_cleanup_failed")
  }
  return value
}

export function createNotificationLocalCleanupController({
  runtimeManifest,
  localEnvironment,
  execute,
  state = { localStartAttempted: false },
} = {}) {
  const manifest = assertNotificationLocalRuntimeManifest(runtimeManifest)
  if (typeof execute !== "function" || !isEnvironmentRecord(localEnvironment)) {
    throw new Error("notification_local_db_cleanup_context_refused")
  }
  let cleanupPromise
  let attempts = 0
  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise
    attempts += 1
    cleanupPromise = (async () => {
      try {
        const result = await execute(buildNotificationLocalQaInvocation("cleanup", {
          runtimeManifest: manifest,
          localEnvironment,
          state,
        }))
        return deepFreeze({
          cleanupCode: "notification_local_db_cleanup_ok",
          evidence: assertCleanupEvidence(normalizeInvocationResult(
            result,
            "notification_local_db_cleanup_failed",
          )),
        })
      } catch {
        return deepFreeze({
          cleanupCode: "notification_local_db_cleanup_failed",
          evidence: null,
        })
      }
    })()
    return cleanupPromise
  }
  const signalHandler = () => {
    state.signalReceived = true
    return deepFreeze({
      primaryCode: "notification_local_db_signal_received",
      cleanupCode: "notification_local_db_cleanup_deferred",
    })
  }
  return Object.freeze({
    cleanup,
    get attempts() {
      return attempts
    },
    signalHandlers: Object.freeze({ SIGINT: signalHandler, SIGTERM: signalHandler }),
  })
}

function executeBoundedProcess({
  command,
  args,
  cwd,
  env,
  timeoutMs = 20 * 60 * 1000,
  maxStdoutBytes = MAX_LOCAL_STDOUT_BYTES,
  maxStderrBytes = MAX_STDERR_BYTES,
  abortSignal,
}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    const stdout = []
    const stderr = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let overflowed = false
    let aborted = false
    let spawnErrored = false
    let terminationRequested = false
    let timeout
    let forceKillTimeout
    let forceFinishTimeout
    const finish = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      clearTimeout(forceKillTimeout)
      clearTimeout(forceFinishTimeout)
      abortSignal?.removeEventListener?.("abort", handleAbort)
      resolvePromise({
        code: overflowed || aborted || spawnErrored
          ? 1
          : Number.isInteger(code) ? code : 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      })
    }
    const terminate = () => {
      if (terminationRequested || settled) return
      terminationRequested = true
      const gracefulTimeoutMs = basename(command) === "supabase-go" ? 30 * 1000 : 5 * 1000
      child.kill(basename(command) === "supabase-go" ? "SIGINT" : "SIGTERM")
      forceKillTimeout = setTimeout(() => child.kill("SIGKILL"), gracefulTimeoutMs)
      forceFinishTimeout = setTimeout(() => finish(1), gracefulTimeoutMs + 5 * 1000)
    }
    const handleAbort = () => {
      aborted = true
      terminate()
    }
    const append = (chunks, chunk, kind) => {
      const value = Buffer.from(chunk)
      if (kind === "stdout") stdoutBytes += value.byteLength
      else stderrBytes += value.byteLength
      if (stdoutBytes > maxStdoutBytes || stderrBytes > maxStderrBytes) {
        overflowed = true
        terminate()
        return
      }
      chunks.push(value)
    }
    timeout = setTimeout(() => {
      overflowed = true
      terminate()
    }, timeoutMs)
    child.stdout.on("data", (chunk) => append(stdout, chunk, "stdout"))
    child.stderr.on("data", (chunk) => append(stderr, chunk, "stderr"))
    child.once("error", () => {
      spawnErrored = true
      if (child.pid) terminate()
      else finish(1)
    })
    child.once("close", finish)
    if (abortSignal instanceof AbortSignal) {
      if (abortSignal.aborted) handleAbort()
      else abortSignal.addEventListener("abort", handleAbort, { once: true })
    }
  })
}

function buildRemoteCollectorDockerEnvironment(sourceEnvironment) {
  const environment = {}
  for (const key of LOCAL_ENV_SOURCE_KEYS) {
    if (typeof sourceEnvironment?.[key] === "string") environment[key] = sourceEnvironment[key]
  }
  return Object.freeze(environment)
}

function parseRemoteCollectorContainerIds(value) {
  const ids = String(value).split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean)
  if (ids.some((id) => !/^[a-f0-9]{64}$/u.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error("notification_local_db_remote_container_cleanup_failed")
  }
  return Object.freeze(ids)
}

function parseRemoteCollectorOwnedContainers(value) {
  const containers = []
  for (const line of String(value).split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean)) {
    const separator = line.indexOf("|")
    if (separator <= 0 || separator !== line.lastIndexOf("|")) {
      throw new Error("notification_local_db_remote_container_cleanup_failed")
    }
    const id = line.slice(0, separator)
    const projectId = line.slice(separator + 1)
    if (!/^[a-f0-9]{64}$/u.test(id) || !/^[A-Za-z0-9._-]{1,128}$/u.test(projectId)) {
      throw new Error("notification_local_db_remote_container_cleanup_failed")
    }
    if (REMOTE_COLLECTOR_PROJECT_PATTERN.test(projectId)) {
      containers.push(Object.freeze({ id, projectId }))
    }
  }
  return Object.freeze(containers)
}

async function executeRemoteCollectorDockerCall({
  runtime,
  sourceEnvironment,
  executeProcess,
  args,
  abortSignal,
}) {
  assertNotificationRemoteCollectorRuntime(runtime)
  let result
  try {
    result = await executeProcess({
      step: "remote-collector-docker",
      command: DEFAULT_DOCKER_CLI_PATH,
      args,
      cwd: runtime.workdir,
      env: buildRemoteCollectorDockerEnvironment(sourceEnvironment),
      timeoutMs: 2 * 60 * 1000,
      maxStdoutBytes: MAX_STATUS_STDOUT_BYTES,
      maxStderrBytes: MAX_STDERR_BYTES,
      ...(abortSignal instanceof AbortSignal ? { abortSignal } : {}),
    })
  } catch {
    throw new Error("notification_local_db_remote_container_cleanup_failed")
  }
  if (
    result?.code !== 0
    || typeof result.stdout !== "string"
    || typeof result.stderr !== "string"
    || Buffer.byteLength(result.stdout) > MAX_STATUS_STDOUT_BYTES
    || Buffer.byteLength(result.stderr) > MAX_STDERR_BYTES
  ) throw new Error("notification_local_db_remote_container_cleanup_failed")
  return result
}

export function createNotificationRemoteCollectorCleanupController({
  runtime,
  sourceEnvironment,
  executeProcess = executeBoundedProcess,
} = {}) {
  const collectorRuntime = assertNotificationRemoteCollectorRuntime(runtime)
  if (!isEnvironmentRecord(sourceEnvironment) || typeof executeProcess !== "function") {
    throw new Error("notification_local_db_remote_runtime_refused")
  }
  const listArgs = Object.freeze([
    "ps", "-aq", "--no-trunc",
    "--filter", `label=${collectorRuntime.label.key}=${collectorRuntime.label.value}`,
  ])
  const preflightArgs = Object.freeze([
    "ps", "-a", "--no-trunc",
    "--filter", `label=${collectorRuntime.label.key}`,
    "--format", `{{.ID}}|{{.Label "${collectorRuntime.label.key}"}}`,
  ])
  let preflightPassed = false
  let cleanupPromise
  const listIds = async (abortSignal) => {
    const result = await executeRemoteCollectorDockerCall({
      runtime: collectorRuntime,
      sourceEnvironment,
      executeProcess,
      args: listArgs,
      abortSignal,
    })
    return parseRemoteCollectorContainerIds(result.stdout)
  }
  const preflight = async (abortSignal) => {
    assertNotificationRunNotAborted(abortSignal)
    const result = await executeRemoteCollectorDockerCall({
      runtime: collectorRuntime,
      sourceEnvironment,
      executeProcess,
      args: preflightArgs,
      abortSignal,
    })
    const ownedContainers = parseRemoteCollectorOwnedContainers(result.stdout)
    assertNotificationRunNotAborted(abortSignal)
    if (ownedContainers.length !== 0) {
      throw new Error("notification_local_db_remote_container_preexisting_refused")
    }
    preflightPassed = true
    return deepFreeze({ ownedContainersBefore: 0 })
  }
  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise
    cleanupPromise = (async () => {
      if (!preflightPassed) {
        return deepFreeze({
          cleanupCode: "notification_local_db_cleanup_not_required",
          evidence: { ownedContainersRemaining: 0, removedContainerCount: 0 },
        })
      }
      try {
        const ids = await listIds()
        if (ids.length > 0) {
          await executeRemoteCollectorDockerCall({
            runtime: collectorRuntime,
            sourceEnvironment,
            executeProcess,
            args: ["rm", "--force", ...ids],
          })
        }
        const remaining = await listIds()
        if (remaining.length !== 0) {
          throw new Error("notification_local_db_remote_container_cleanup_failed")
        }
        return deepFreeze({
          cleanupCode: "notification_local_db_cleanup_ok",
          evidence: {
            ownedContainersRemaining: 0,
            removedContainerCount: ids.length,
          },
        })
      } catch {
        return deepFreeze({
          cleanupCode: "notification_local_db_cleanup_failed",
          evidence: null,
        })
      }
    })()
    return cleanupPromise
  }
  return Object.freeze({ preflight, cleanup })
}

export async function runNotificationRemoteCollectorWithCleanup({
  collectorContext,
  collectorRuntime,
  cleanupController,
  collect = collectRemoteSchemaMetadata,
  execute = executeBoundedProcess,
} = {}) {
  const runtime = assertNotificationRemoteCollectorRuntime(collectorRuntime)
  if (
    collectorContext?.approved !== true
    || typeof cleanupController?.preflight !== "function"
    || typeof cleanupController?.cleanup !== "function"
    || typeof collect !== "function"
    || typeof execute !== "function"
    || (
      collectorContext.abortSignal !== undefined
      && !(collectorContext.abortSignal instanceof AbortSignal)
    )
  ) throw new Error("notification_local_db_remote_runtime_refused")

  const abortSignal = collectorContext.abortSignal
  await cleanupController.preflight(abortSignal)
  let remoteCollection
  let remoteCollectionError
  try {
    remoteCollection = await collect(
      collectorContext,
      execute,
      { collectorRuntime: runtime },
    )
  } catch (error) {
    remoteCollectionError = error
  }

  let collectorCleanup
  try {
    collectorCleanup = await cleanupController.cleanup()
  } catch {
    collectorCleanup = { cleanupCode: "notification_local_db_cleanup_failed" }
  }
  const cleanupCode = collectorCleanup?.cleanupCode === "notification_local_db_cleanup_ok"
    ? "notification_local_db_cleanup_ok"
    : "notification_local_db_cleanup_failed"
  if (remoteCollectionError !== undefined || abortSignal?.aborted || cleanupCode !== "notification_local_db_cleanup_ok") {
    const rawRemoteCode = String(remoteCollectionError?.message ?? "").split(":", 1)[0]
    const primaryCode = abortSignal?.aborted
      ? "notification_local_db_signal_received"
      : safeFailureCode(rawRemoteCode, "notification_local_db_remote_collector_failed")
    throw new NotificationLocalDbQaError(primaryCode, cleanupCode)
  }
  return remoteCollection
}

function successfulLocalResult(evidence, stdout = "") {
  return {
    code: 0,
    stdout,
    stderr: "",
    evidence: deepFreeze(evidence),
  }
}

function failedLocalResult() {
  return { code: 1, stdout: "", stderr: "", evidence: {} }
}

async function runTrustedProcess(invocation, overrides = {}) {
  const executeProcess = invocation[TRUSTED_PROCESS_EXECUTOR] ?? executeBoundedProcess
  const result = await executeProcess({
    step: invocation.step,
    command: overrides.command ?? invocation.command,
    args: overrides.args ?? invocation.args,
    cwd: overrides.cwd ?? invocation.cwd,
    env: invocation.env,
    timeoutMs: overrides.timeoutMs ?? invocation.timeoutMs,
    maxStdoutBytes: overrides.maxStdoutBytes ?? invocation.maxStdoutBytes,
    maxStderrBytes: overrides.maxStderrBytes ?? invocation.maxStderrBytes,
    abortSignal: overrides.abortSignal ?? invocation.abortSignal,
  })
  if (
    result.code !== 0
    || Buffer.byteLength(result.stdout) > invocation.maxStdoutBytes
    || Buffer.byteLength(result.stderr) > invocation.maxStderrBytes
  ) {
    throw new Error("notification_local_db_child_failed")
  }
  return result
}

function parseStrictJson(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("notification_local_db_json_invalid")
  }
  try {
    return JSON.parse(value.trim())
  } catch {
    throw new Error("notification_local_db_json_invalid")
  }
}

function findExactJsonAlias(stdout, alias) {
  const payload = parseStrictJson(stdout)
  if (!Array.isArray(payload) || payload.length !== 1 || !hasExactKeys(payload[0], [alias])) {
    throw new Error("notification_local_db_json_invalid")
  }
  const value = payload[0][alias]
  if (typeof value === "string") return parseStrictJson(value)
  if (!isPlainRecord(value) && !Array.isArray(value)) {
    throw new Error("notification_local_db_json_invalid")
  }
  return value
}

async function assertOwnedRuntimeRoot(manifest) {
  const rootStat = await lstat(manifest.tempRoot)
  const realTemporaryRoot = await realpath(tmpdir())
  const realRuntimeRoot = await realpath(manifest.tempRoot)
  if (
    !rootStat.isDirectory()
    || rootStat.isSymbolicLink()
    || (rootStat.mode & 0o777) !== 0o700
    || !isPathInside(realTemporaryRoot, realRuntimeRoot)
  ) throw new Error("notification_local_db_runtime_root_refused")
}

async function writeOwnedRuntimeFile(manifest, relativePath, contents) {
  const target = resolve(manifest.tempRoot, relativePath)
  if (!isPathInside(manifest.tempRoot, target)) {
    throw new Error("notification_local_db_runtime_file_refused")
  }
  await mkdir(resolve(target, ".."), { recursive: true, mode: 0o700 })
  await writeFile(target, contents, { encoding: "utf8", mode: 0o600 })
  await chmod(target, 0o600)
  const targetStat = await lstat(target)
  if (!targetStat.isFile() || targetStat.isSymbolicLink() || (targetStat.mode & 0o777) !== 0o600) {
    throw new Error("notification_local_db_runtime_file_refused")
  }
  return target
}

async function readHashedRegularFile(filePath, expectedHash) {
  const before = await lstat(filePath, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error("notification_local_db_runtime_file_refused")
  }
  const contents = await readFile(filePath)
  const after = await lstat(filePath, { bigint: true })
  if (
    !sameFileSnapshot(before, after)
    || (typeof expectedHash === "string" && sha256(contents) !== expectedHash)
  ) {
    throw new Error("notification_local_db_runtime_file_refused")
  }
  return contents
}

async function prepareLocalDatabaseWorkdir(invocation) {
  const manifest = invocation.runtimeManifest
  const migrationsDir = join(manifest.tempRoot, "supabase", "migrations")
  const home = invocation.env.HOME
  await mkdir(migrationsDir, { recursive: true, mode: 0o700 })
  await mkdir(join(home, ".cache"), { recursive: true, mode: 0o700 })
  await mkdir(join(home, ".config"), { recursive: true, mode: 0o700 })
  if ((await readdir(migrationsDir)).length !== 0) {
    throw new Error("notification_local_db_migrations_not_empty")
  }
  const config = [
    `project_id = "${manifest.projectId}"`,
    "",
    "[api]",
    "enabled = false",
    "",
    "[db]",
    `port = ${manifest.database.port}`,
    `major_version = ${invocation.executionContract.postgresMajor}`,
    "",
    "[db.pooler]",
    "enabled = false",
    "",
    "[db.seed]",
    "enabled = false",
    "",
    "[realtime]",
    "enabled = false",
    "",
    "[studio]",
    "enabled = false",
    "",
    "[inbucket]",
    "enabled = false",
    "",
    "[storage]",
    "enabled = false",
    "",
    "[storage.s3_protocol]",
    "enabled = false",
    "",
    // `db start` needs the one-shot local GoTrue migration to create auth.users.
    // No Auth service remains after this database-only bootstrap.
    "[auth]",
    "enabled = true",
    "",
    "[edge_runtime]",
    "enabled = false",
    "",
    "[analytics]",
    "enabled = false",
    "",
  ].join("\n")
  await writeOwnedRuntimeFile(manifest, "supabase/config.toml", config)
  await writeOwnedRuntimeFile(manifest, "notification-local-ownership.json", `${JSON.stringify({
    version: 1,
    projectId: manifest.projectId,
    manifestSha256: manifest.sha256,
    state: "start-attempted",
    localStartAttempted: true,
  })}\n`)
}

function parseDockerResourceLines(value, projectId) {
  const resources = []
  for (const line of String(value).split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean)) {
    const separator = line.indexOf("|")
    const label = separator >= 0 ? line.slice(0, separator) : ""
    const name = separator >= 0 ? line.slice(separator + 1) : line
    if (
      label === projectId
      || label.startsWith("tips_notification_db_qa_")
      || name.startsWith("supabase_db_tips_notification_db_qa_")
      || name.startsWith("tips_notification_db_qa_")
    ) {
      resources.push({ label, name })
    }
  }
  return resources
}

async function inspectQaResources(invocation, { includeAllQaRuns = false } = {}) {
  const manifest = invocation.runtimeManifest
  const builtInLabel = "com.supabase.cli.project"
  const commands = [
    ["ps", "-a", "--format", `{{.Label \"${builtInLabel}\"}}|{{.Names}}`],
    ["volume", "ls", "--format", `{{.Label \"${builtInLabel}\"}}|{{.Name}}`],
    ["network", "ls", "--format", `{{.Label \"${builtInLabel}\"}}|{{.Name}}`],
  ]
  const kinds = ["container", "volume", "network"]
  const resources = []
  for (let index = 0; index < commands.length; index += 1) {
    const result = await runTrustedProcess(invocation, {
      command: DEFAULT_DOCKER_CLI_PATH,
      args: commands[index],
    })
    const matches = parseDockerResourceLines(result.stdout, manifest.projectId)
      .filter((entry) => includeAllQaRuns
        || entry.label === manifest.projectId
        || manifest.ownership[`${kinds[index]}s`]?.includes(entry.name))
      .map((entry) => ({ kind: kinds[index], name: entry.name }))
    resources.push(...matches)
  }
  return resources
}

export function assertNotificationDockerServerVersion(value, minimumMajor) {
  try {
    const version = parseStrictJson(value)
    const match = typeof version === "string" ? /^(\d+)\.\d+\.\d+/u.exec(version) : null
    const major = Number(match?.[1])
    if (!Number.isInteger(minimumMajor) || !Number.isInteger(major) || major < minimumMajor) {
      throw new Error("notification_local_db_docker_version_refused")
    }
    return major
  } catch (error) {
    if (error?.message === "notification_local_db_docker_version_refused") throw error
    throw new Error("notification_local_db_docker_version_refused")
  }
}

export function assertNotificationDockerNetworkContract(value, runtimeManifest) {
  try {
    const manifest = assertNotificationLocalRuntimeManifest(runtimeManifest)
    const payload = parseStrictJson(value)
    const networkId = payload?.Id
    if (
      !isPlainRecord(payload)
      || !/^[a-f0-9]{64}$/u.test(networkId ?? "")
      || payload.Name !== manifest.dockerNetwork.name
      || payload.Driver !== manifest.dockerNetwork.driver
      || payload.Scope !== "local"
      || payload.Internal !== true
      || payload.EnableIPv6 !== false
      || payload.Options?.["com.docker.network.bridge.host_binding_ipv4"]
        !== manifest.dockerNetwork.hostBindingIpv4
      || payload.Labels?.[manifest.ownership.label.key] !== manifest.projectId
      || payload.Labels?.["com.supabase.cli.project"] !== manifest.projectId
    ) throw new Error("notification_local_db_network_contract_refused")
    return Object.freeze({ networkId })
  } catch (error) {
    if (error?.message === "notification_local_db_network_contract_refused") throw error
    throw new Error("notification_local_db_network_contract_refused")
  }
}

export function assertNotificationLocalDatabaseContainerContract(
  value,
  runtimeManifest,
  expectedNetworkId,
) {
  try {
    const manifest = assertNotificationLocalRuntimeManifest(runtimeManifest)
    const payload = parseStrictJson(value)
    const ports = payload?.NetworkSettings?.Ports
    const databaseBindings = ports?.["5432/tcp"]
    const networks = payload?.NetworkSettings?.Networks
    if (
      !/^[a-f0-9]{64}$/u.test(expectedNetworkId ?? "")
      || payload?.Name !== `/${manifest.ownership.containers[0]}`
      || payload?.Config?.Labels?.["com.supabase.cli.project"] !== manifest.projectId
      || payload?.HostConfig?.NetworkMode !== manifest.dockerNetwork.name
      || !isPlainRecord(ports)
      || JSON.stringify(Object.keys(ports)) !== JSON.stringify(["5432/tcp"])
      || !Array.isArray(databaseBindings)
      || databaseBindings.length !== 1
      || databaseBindings[0]?.HostIp !== "127.0.0.1"
      || databaseBindings[0]?.HostPort !== String(manifest.database.port)
      || !isPlainRecord(networks)
      || JSON.stringify(Object.keys(networks)) !== JSON.stringify([manifest.dockerNetwork.name])
      || networks[manifest.dockerNetwork.name]?.NetworkID !== expectedNetworkId
    ) throw new Error("notification_local_db_start_binding_refused")
    return Object.freeze({ databasePort: manifest.database.port, networkId: expectedNetworkId })
  } catch (error) {
    if (error?.message === "notification_local_db_start_binding_refused") throw error
    throw new Error("notification_local_db_start_binding_refused")
  }
}

export function assertNotificationLocalRuntimeResourceSet(value, runtimeManifest) {
  try {
    const manifest = assertNotificationLocalRuntimeManifest(runtimeManifest)
    const expected = [
      { kind: "container", name: manifest.ownership.containers[0] },
      { kind: "volume", name: manifest.ownership.volumes[0] },
      { kind: "network", name: manifest.ownership.networks[0] },
    ]
    if (
      !Array.isArray(value)
      || value.length !== expected.length
      || value.some((entry) => !hasExactKeys(entry, ["kind", "name"]))
      || JSON.stringify(value) !== JSON.stringify(expected)
    ) throw new Error("notification_local_db_start_resource_refused")
    return Object.freeze(expected.map((entry) => Object.freeze({ ...entry })))
  } catch (error) {
    if (error?.message === "notification_local_db_start_resource_refused") throw error
    throw new Error("notification_local_db_start_resource_refused")
  }
}

function assertNoRuntimeActivation(value) {
  const source = String(value)
  const runtimeFlagInsert = /insert\s+into\s+dashboard_private\s*\.\s*notification_runtime_flags[\s\S]*?values([\s\S]*?);/giu
  const enabledInsert = [...source.matchAll(runtimeFlagInsert)]
    .some((match) => /\btrue\b/iu.test(match[1]))
  if (
    /\bcron\s*\.\s*schedule\s*\(/iu.test(source)
    || /\bnet\s*\.\s*http_(?:get|post|put|delete)\s*\(/iu.test(source)
    || /update\s+dashboard_private\s*\.\s*notification_runtime_flags[\s\S]{0,500}?set\s+enabled\s*=\s*true/iu.test(source)
    || enabledInsert
  ) {
    throw new Error("notification_local_db_runtime_activation_refused")
  }
}

export function parseNotificationMigrationDryRun(result, pendingMigrations) {
  const expected = normalizeRuntimePendingMigrations(pendingMigrations)
  if (typeof result?.stdout !== "string" || typeof result?.stderr !== "string") {
    throw new Error("notification_local_db_migration_failed")
  }
  const output = `${result.stdout}\n${result.stderr}`
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/\r\n?/gu, "\n")
  const allFileNames = [...output.matchAll(/\b\d{14}_[a-z0-9_]+\.sql\b/gu)]
    .map((match) => match[0])
  const expectedFileNames = expected.map(({ fileName }) => fileName)
  if (expectedFileNames.length === 0) {
    if (allFileNames.length !== 0 || !/Local database is up to date\./iu.test(output)) {
      throw new Error("notification_local_db_migration_failed")
    }
    return Object.freeze([])
  }
  const lines = output.split("\n")
  const headerIndexes = lines.flatMap((line, index) => (
    /^\s*Would push these migrations:\s*$/iu.test(line) ? [index] : []
  ))
  const fileNames = []
  if (headerIndexes.length === 1) {
    for (let index = headerIndexes[0] + 1; index < lines.length; index += 1) {
      const line = lines[index]
      if (line.trim() === "" && fileNames.length === 0) continue
      const match = /^\s*(?:[•*-]\s*)?(\d{14}_[a-z0-9_]+\.sql)\s*$/u.exec(line)
      if (!match) break
      fileNames.push(match[1])
    }
  }
  if (
    headerIndexes.length !== 1
    || JSON.stringify(fileNames) !== JSON.stringify(expectedFileNames)
    || JSON.stringify(allFileNames) !== JSON.stringify(expectedFileNames)
  ) throw new Error("notification_local_db_migration_failed")
  return Object.freeze(fileNames)
}

export function assertNotificationPgTapSummary(value, expectedFileCount) {
  const output = String(value).replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "")
  const summary = /(?:^|\n)Files=(\d+),\s*Tests=(\d+)\b/u.exec(output)
  const fileCount = Number(summary?.[1])
  const testCount = Number(summary?.[2])
  if (
    !Number.isInteger(expectedFileCount)
    || expectedFileCount < 1
    || !/All tests successful\./iu.test(output)
    || !summary
    || fileCount !== expectedFileCount
    || !Number.isInteger(testCount)
    || testCount < 1
    || !/(?:^|\n)Result:\s*PASS\s*(?:\n|$)/iu.test(output)
    || /(?:^|\n)\s*not ok\b/iu.test(output)
    || /Bail out!|Bailout|Dubious|Result:\s*FAIL/iu.test(output)
  ) throw new Error("notification_local_db_pgtap_failed")
  return Object.freeze({ fileCount, testCount })
}

async function verifyStagedMigrationCatalog(manifest) {
  const destinationDirectory = join(manifest.tempRoot, "supabase", "migrations")
  const names = (await readdir(destinationDirectory)).sort()
  const expectedNames = manifest.migrationCatalog.map(({ fileName }) => fileName).sort()
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    throw new Error("notification_local_db_migration_failed")
  }
  for (const migration of manifest.migrationCatalog) {
    const destination = join(destinationDirectory, migration.fileName)
    await readHashedRegularFile(destination, migration.sha256)
    if (Number((await lstat(destination)).mode & 0o777) !== 0o600) {
      throw new Error("notification_local_db_migration_failed")
    }
  }
  return manifest.migrationCatalog
}

export async function stageNotificationMigrationCatalog(runtimeManifest, { repoRoot = ROOT } = {}) {
  const manifest = assertNotificationLocalRuntimeManifest(runtimeManifest)
  try {
    const catalog = await loadLocalMigrationCatalog(repoRoot)
    if (JSON.stringify(catalog.migrations) !== JSON.stringify(manifest.migrationCatalog)) {
      throw new Error("notification_local_db_migration_failed")
    }
    const destinationDirectory = join(manifest.tempRoot, "supabase", "migrations")
    const destinationStat = await lstat(destinationDirectory)
    if (
      !destinationStat.isDirectory()
      || destinationStat.isSymbolicLink()
      || (destinationStat.mode & 0o777) !== 0o700
      || (await readdir(destinationDirectory)).length !== 0
    ) throw new Error("notification_local_db_migration_failed")

    for (const migration of manifest.migrationCatalog) {
      const source = resolve(catalog.repoRoot, migration.relativePath)
      if (!isPathInside(catalog.repoRoot, source)) {
        throw new Error("notification_local_db_migration_failed")
      }
      await readHashedRegularFile(source, migration.sha256)
      const destination = join(destinationDirectory, migration.fileName)
      await copyFile(source, destination, fileConstants.COPYFILE_EXCL)
      await chmod(destination, 0o600)
      await readHashedRegularFile(source, migration.sha256)
      await readHashedRegularFile(destination, migration.sha256)
    }
    return await verifyStagedMigrationCatalog(manifest)
  } catch (error) {
    if (error?.message === "notification_local_db_migration_failed") throw error
    throw new Error("notification_local_db_migration_failed")
  }
}

async function scanExactPendingMigrations(invocation) {
  const manifest = invocation.runtimeManifest
  for (const migration of manifest.pendingMigrations) {
    const destination = join(manifest.tempRoot, "supabase", "migrations", migration.fileName)
    const contents = await readHashedRegularFile(destination, migration.sha256)
    assertNoRuntimeActivation(contents.toString("utf8"))
  }
}

async function runLocalQueryFile(invocation, filePath, { json = false } = {}) {
  const args = [
    "db", "query", "--db-url", invocation.runtimeManifest.database.url,
    "--file", filePath,
    ...(json ? ["--output", "json"] : []),
  ]
  return runTrustedProcess(invocation, {
    command: DEFAULT_SUPABASE_GO_CLI_PATH,
    args,
  })
}

async function assertInternalNetwork(invocation, expectedNetworkId = invocation.state.dockerNetworkId) {
  if (!/^[a-f0-9]{64}$/u.test(expectedNetworkId ?? "")) {
    throw new Error("notification_local_db_network_not_internal")
  }
  const result = await runTrustedProcess(invocation, {
    command: DEFAULT_DOCKER_CLI_PATH,
    args: [
      "network", "inspect", expectedNetworkId,
      "--format", "{{json .}}",
    ],
  })
  let contract
  try {
    contract = assertNotificationDockerNetworkContract(
      result.stdout,
      invocation.runtimeManifest,
    )
  } catch {
    throw new Error("notification_local_db_network_not_internal")
  }
  if (contract.networkId !== expectedNetworkId) {
    throw new Error("notification_local_db_network_not_internal")
  }
  return contract
}

async function executeResourcePreflight(invocation) {
  const versionResult = await runTrustedProcess(invocation, {
    command: DEFAULT_DOCKER_CLI_PATH,
    args: ["version", "--format", "{{json .Server.Version}}"],
  })
  const dockerServerMajor = assertNotificationDockerServerVersion(
    versionResult.stdout,
    invocation.runtimeManifest.dockerNetwork.minimumServerMajor,
  )
  const resources = await inspectQaResources(invocation, { includeAllQaRuns: true })
  return successfulLocalResult({
    dockerServerMajor,
    ownedResourceCount: resources.length,
    resources,
  })
}

async function executeNetworkCreate(invocation) {
  const result = await runTrustedProcess(invocation, { command: DEFAULT_DOCKER_CLI_PATH })
  const networkId = result.stdout.trim()
  const contract = await assertInternalNetwork(invocation, networkId)
  return successfulLocalResult({
    networkId: contract.networkId,
    networkName: invocation.runtimeManifest.dockerNetwork.name,
    driver: invocation.runtimeManifest.dockerNetwork.driver,
    hostBindingIpv4: invocation.runtimeManifest.dockerNetwork.hostBindingIpv4,
    internal: true,
  })
}

async function executeLocalDatabaseStart(invocation) {
  await prepareLocalDatabaseWorkdir(invocation)
  await runTrustedProcess(invocation)
  const inspect = await runTrustedProcess(invocation, {
    command: DEFAULT_DOCKER_CLI_PATH,
    args: [
      "inspect", "--type", "container", invocation.runtimeManifest.ownership.containers[0],
      "--format", "{{json .}}",
    ],
  })
  assertNotificationLocalDatabaseContainerContract(
    inspect.stdout,
    invocation.runtimeManifest,
    invocation.state.dockerNetworkId,
  )
  await assertInternalNetwork(invocation)
  const resources = assertNotificationLocalRuntimeResourceSet(
    await inspectQaResources(invocation),
    invocation.runtimeManifest,
  )
  return successfulLocalResult({
    projectId: invocation.runtimeManifest.projectId,
    databaseHost: invocation.runtimeManifest.database.host,
    databasePort: invocation.runtimeManifest.database.port,
    ownedResourceCount: resources.length,
    serviceContainersRemaining: 0,
    started: true,
  })
}

async function executePublicDefaultPrivileges(invocation) {
  const filePath = await writeOwnedRuntimeFile(
    invocation.runtimeManifest,
    "public-default-privileges.sql",
    PUBLIC_DEFAULT_PRIVILEGES_SQL,
  )
  await runLocalQueryFile(invocation, filePath)
  return successfulLocalResult({ publicDefaultPrivilegesRevoked: true })
}

async function executeSchemaRestore(invocation) {
  const schema = await readHashedRegularFile(
    invocation.executionContract.schemaDumpPath,
    invocation.executionContract.schemaDumpSha256,
  )
  const text = schema.toString("utf8")
  if (
    /^-- Data for Name:/mu.test(text)
    || /^COPY\s+.+\s+FROM\s+stdin;/imu.test(text)
    || /\bCOPY\s+.+\s+(?:TO|FROM)\s+PROGRAM\b/iu.test(text)
    || /\bCREATE\s+(?:SUBSCRIPTION|SERVER|USER\s+MAPPING)\b/iu.test(text)
    || /https:\/\/chat\.googleapis\.com\//iu.test(text)
  ) {
    throw new Error("notification_local_db_restore_failed")
  }
  await runLocalQueryFile(invocation, invocation.executionContract.schemaDumpPath)
  await readHashedRegularFile(
    invocation.executionContract.schemaDumpPath,
    invocation.executionContract.schemaDumpSha256,
  )
  return successfulLocalResult({
    restored: true,
    rowDataCopied: 0,
    schemaSha256: invocation.executionContract.schemaDumpSha256,
  })
}

async function executeCatalogPostflight(invocation) {
  const filePath = await writeOwnedRuntimeFile(
    invocation.runtimeManifest,
    "local-catalog-postflight.sql",
    LOCAL_CATALOG_POSTFLIGHT_SQL,
  )
  const result = await runLocalQueryFile(invocation, filePath, { json: true })
  const evidence = findExactJsonAlias(
    result.stdout,
    "notification_local_qa_catalog_postflight",
  )
  if (
    !hasExactKeys(evidence, [
      "extensions_ok",
      "rls_policy_count",
      "rls_relation_count",
      "roles_ok",
      "schemas_ok",
      "unexpected_owner_count",
      "unexpected_public_create_grants",
    ])
    || evidence.roles_ok !== true
    || evidence.schemas_ok !== true
    || evidence.extensions_ok !== true
    || !Number.isInteger(evidence.rls_relation_count)
    || evidence.rls_relation_count < 1
    || !Number.isInteger(evidence.rls_policy_count)
    || evidence.rls_policy_count < 1
    || evidence.unexpected_owner_count !== 0
    || evidence.unexpected_public_create_grants !== 0
  ) {
    throw new Error("notification_local_db_restore_failed")
  }
  return successfulLocalResult({ ownerGrantRlsExtensionChecksPassed: true })
}

async function readLocalMigrationHistory(invocation, fileName) {
  const historyFile = await writeOwnedRuntimeFile(
    invocation.runtimeManifest,
    fileName,
    `begin read only;
select coalesce(pg_catalog.jsonb_agg(
  pg_catalog.jsonb_build_object('version', version, 'name', name) order by version
), '[]'::jsonb) as notification_local_qa_migration_history
from supabase_migrations.schema_migrations;
rollback;
`,
  )
  const result = await runLocalQueryFile(invocation, historyFile, { json: true })
  return findExactJsonAlias(result.stdout, "notification_local_qa_migration_history")
}

async function executeRemoteMigrationRepair(invocation) {
  if (invocation.executionContract.appliedMigrations.length === 0) {
    throw new Error("notification_local_db_migration_failed")
  }
  const stagedCatalog = await stageNotificationMigrationCatalog(invocation.runtimeManifest)
  await runTrustedProcess(invocation)
  await verifyStagedMigrationCatalog(invocation.runtimeManifest)
  const rows = await readLocalMigrationHistory(
    invocation,
    "local-migration-history-postflight.sql",
  )
  if (JSON.stringify(rows) !== JSON.stringify(invocation.executionContract.appliedMigrations)) {
    throw new Error("notification_local_db_migration_failed")
  }
  return successfulLocalResult({
    stagedCatalog: stagedCatalog.map(({ fileName }) => fileName),
    repairedVersions: invocation.executionContract.appliedMigrations.map(({ version }) => version),
  })
}

async function executePendingMigrationCopy(invocation) {
  const migrationCatalog = await verifyStagedMigrationCatalog(invocation.runtimeManifest)
  return successfulLocalResult({
    migrationCatalog,
    pendingMigrations: invocation.runtimeManifest.pendingMigrations,
  })
}

async function executeRuntimeActivationScan(invocation) {
  await scanExactPendingMigrations(invocation)
  return successfulLocalResult({ unsafeActivationCount: 0 })
}

async function executeLocalMigrationPush(invocation) {
  const manifest = invocation.runtimeManifest
  await verifyStagedMigrationCatalog(manifest)
  const beforeHistory = await readLocalMigrationHistory(
    invocation,
    "local-migration-history-before-push.sql",
  )
  if (JSON.stringify(beforeHistory) !== JSON.stringify(invocation.executionContract.appliedMigrations)) {
    throw new Error("notification_local_db_migration_failed")
  }
  const dryRun = await runTrustedProcess(invocation)
  const dryRunOutput = `${dryRun.stdout}\n${dryRun.stderr}`
  assertNoRuntimeActivation(dryRunOutput)
  parseNotificationMigrationDryRun(dryRun, manifest.pendingMigrations)
  await verifyStagedMigrationCatalog(manifest)
  await scanExactPendingMigrations(invocation)
  if (manifest.pendingMigrations.length > 0) {
    const actualArgs = [
      ...invocation.args.filter((value) => value !== "--dry-run"),
      "--yes",
    ]
    await runTrustedProcess(invocation, { args: actualArgs })
  }
  await verifyStagedMigrationCatalog(manifest)
  await scanExactPendingMigrations(invocation)
  const history = await readLocalMigrationHistory(
    invocation,
    "local-migration-history-after-push.sql",
  )
  const expectedHistory = manifest.migrationCatalog.map(({ version, name }) => ({
    version,
    name,
  }))
  if (JSON.stringify(history) !== JSON.stringify(expectedHistory)) {
    throw new Error("notification_local_db_migration_failed")
  }
  return successfulLocalResult({
    dryRunPassed: true,
    appliedPendingVersions: manifest.pendingMigrations.map(({ version }) => version),
  })
}

async function executeSyntheticFixture(invocation) {
  const manifest = invocation.runtimeManifest
  const fixturePath = resolve(ROOT, manifest.fixture.relativePath)
  if (!isPathInside(ROOT, fixturePath)) throw new Error("notification_local_db_fixture_failed")
  await readHashedRegularFile(fixturePath, manifest.fixture.sha256)
  await runLocalQueryFile(invocation, fixturePath)
  await readHashedRegularFile(fixturePath, manifest.fixture.sha256)

  const postflightFile = await writeOwnedRuntimeFile(
    manifest,
    "fixture-postflight.sql",
    FIXTURE_POSTFLIGHT_SQL,
  )
  const result = await runLocalQueryFile(invocation, postflightFile, { json: true })
  const raw = findExactJsonAlias(result.stdout, "notification_local_qa_fixture_postflight")
  const counts = {}
  for (const [key, expected] of Object.entries(invocation.executionContract.fixtureExpectedCounts)) {
    if (!Number.isInteger(raw[key]) || raw[key] !== expected) {
      throw new Error("notification_local_db_fixture_failed")
    }
    counts[key] = raw[key]
  }
  if (raw.enabledDispatchFlags !== 0 || raw.connectionSecretRows !== 0) {
    throw new Error("notification_local_db_fixture_failed")
  }
  return successfulLocalResult({ fixtureSqlSha256: manifest.fixture.sha256, counts })
}

async function executeSafetyPostflight(invocation) {
  await assertInternalNetwork(invocation)
  const safetyFile = await writeOwnedRuntimeFile(
    invocation.runtimeManifest,
    "local-safety-postflight.sql",
    SAFETY_POSTFLIGHT_SQL,
  )
  const result = await runLocalQueryFile(invocation, safetyFile, { json: true })
  const raw = findExactJsonAlias(result.stdout, "notification_local_qa_safety")
  if (
    !hasExactKeys(raw, [
      "cronJobs",
      "enabledDispatchFlags",
      "foreignServers",
      "outboundExtensions",
      "pgNetQueuedRequests",
      "queueRows",
      "workerHeartbeats",
      "workerProcesses",
    ])
    || raw.workerProcesses !== 0
    || raw.workerHeartbeats !== 0
    || raw.cronJobs !== 0
    || raw.pgNetQueuedRequests !== 0
    || raw.foreignServers !== 0
    || raw.queueRows !== 0
    || raw.enabledDispatchFlags !== 0
    || !Array.isArray(raw.outboundExtensions)
  ) throw new Error("notification_local_db_safety_postflight_failed")
  return successfulLocalResult({
    egressBlocked: true,
    workerProcesses: 0,
    queueRows: 0,
    enabledDispatchFlags: 0,
  })
}

async function executeEvidenceQuery(invocation) {
  if (typeof invocation.sql !== "string" || invocation.sql.length === 0) {
    throw new Error("notification_local_db_evidence_failed")
  }
  const fileName = invocation.step === "read-only-evidence"
    ? "evidence-read-only.sql"
    : "evidence-round-trip.sql"
  const queryFile = await writeOwnedRuntimeFile(
    invocation.runtimeManifest,
    fileName,
    invocation.sql,
  )
  const result = await runLocalQueryFile(invocation, queryFile, { json: true })
  const raw = findExactJsonAlias(result.stdout, "notification_content_db_evidence")
  const expectedKeys = invocation.step === "read-only-evidence"
    ? [
      "connectionCount",
      "connectionValues",
      "mode",
      "operationalDeltas",
      "runtimeFlagsAllFalseAfter",
      "runtimeFlagsAllFalseBefore",
    ]
    : [
      "bodyTemplate",
      "conflictCode",
      "conflictPreserved",
      "expectedBody",
      "expectedTitle",
      "fixtureWrites",
      "mode",
      "noOpPreserved",
      "operationalDeltas",
      "renderContext",
      "rolledBack",
      "runtimeFlagsAllFalseAfter",
      "runtimeFlagsAllFalseBefore",
      "titleTemplate",
    ]
  if (!hasExactKeys(raw, expectedKeys) || raw.mode !== (
    invocation.step === "read-only-evidence" ? "read-only" : "round-trip"
  )) throw new Error("notification_local_db_evidence_failed")
  if (invocation.step === "disposable-round-trip") {
    const postRollback = await executeSafetyPostflight(invocation)
    if (postRollback.evidence?.enabledDispatchFlags !== 0 || postRollback.evidence?.queueRows !== 0) {
      throw new Error("notification_local_db_evidence_failed")
    }
  }
  return successfulLocalResult(raw)
}

async function executePgTap(invocation) {
  const manifest = invocation.runtimeManifest
  for (const file of manifest.pgTap.files) {
    const source = resolve(ROOT, file.relativePath)
    const destination = resolve(manifest.tempRoot, file.relativePath)
    if (!isPathInside(ROOT, source) || !isPathInside(manifest.tempRoot, destination)) {
      throw new Error("notification_local_db_pgtap_failed")
    }
    await readHashedRegularFile(source, file.sha256)
    await mkdir(resolve(destination, ".."), { recursive: true, mode: 0o700 })
    await copyFile(source, destination, fileConstants.COPYFILE_EXCL)
    await chmod(destination, 0o600)
    await readHashedRegularFile(destination, file.sha256)
  }
  const result = await runTrustedProcess(invocation)
  const summary = assertNotificationPgTapSummary(
    `${result.stdout}\n${result.stderr}`,
    manifest.pgTap.fileCount,
  )
  for (const file of manifest.pgTap.files) {
    await readHashedRegularFile(resolve(manifest.tempRoot, file.relativePath), file.sha256)
  }
  return successfulLocalResult({
    fileCount: manifest.pgTap.fileCount,
    passed: manifest.pgTap.fileCount,
    failed: 0,
    testCount: summary.testCount,
    files: manifest.pgTap.files.map(({ relativePath }) => relativePath),
  })
}

async function executeExactCleanup(invocation) {
  const manifest = invocation.runtimeManifest
  let failed = false
  if (invocation.state.localStartAttempted) {
    try {
      await runTrustedProcess(invocation)
    } catch {
      failed = true
    }
  }

  let resources = []
  try {
    resources = await inspectQaResources(invocation)
    if (resources.some(({ kind, name }) => (
      kind === "network" && name === manifest.dockerNetwork.name
    ))) {
      try {
        const networkTarget = /^[a-f0-9]{64}$/u.test(invocation.state.dockerNetworkId ?? "")
          ? invocation.state.dockerNetworkId
          : manifest.dockerNetwork.name
        await runTrustedProcess(invocation, {
          command: DEFAULT_DOCKER_CLI_PATH,
          args: ["network", "rm", networkTarget],
        })
      } catch {
        failed = true
      }
    }
    resources = await inspectQaResources(invocation)
  } catch {
    failed = true
  }

  const counts = {
    containersRemaining: resources.filter(({ kind }) => kind === "container").length,
    volumesRemaining: resources.filter(({ kind }) => kind === "volume").length,
    networksRemaining: resources.filter(({ kind }) => kind === "network").length,
  }
  const ownedResourcesRemaining = Object.values(counts).reduce((total, value) => total + value, 0)
  if (ownedResourcesRemaining !== 0) failed = true

  if (!failed) {
    try {
      await rm(manifest.tempRoot, { recursive: true, force: true })
    } catch {
      failed = true
    }
  }
  if (failed) return failedLocalResult()
  return successfulLocalResult({ ownedResourcesRemaining, ...counts })
}

async function executeNotificationLocalQaInvocation(invocation) {
  try {
    if (
      !Object.isFrozen(invocation)
      || !LOCAL_ORCHESTRATION_STEPS.includes(invocation.step)
      || invocation.cwd !== invocation.runtimeManifest?.tempRoot
      || invocation.env?.PGHOST !== "127.0.0.1"
      || "SUPABASE_ACCESS_TOKEN" in invocation.env
      || "SUPABASE_DB_PASSWORD" in invocation.env
      || Object.keys(invocation.env).some((key) => /GOOGLE_CHAT|WEBHOOK|SLACK|RESEND|TWILIO|SOLAPI|SMTP/u.test(key))
    ) throw new Error("notification_local_db_invocation_refused")
    assertNotificationLocalRuntimeManifest(invocation.runtimeManifest)
    await assertOwnedRuntimeRoot(invocation.runtimeManifest)
    assertLocalMutationTarget(
      invocation.runtimeManifest.database.url,
      invocation.runtimeManifest.database.port,
    )

    switch (invocation.step) {
      case "preexisting-resource-check": return await executeResourcePreflight(invocation)
      case "internal-network-create": return await executeNetworkCreate(invocation)
      case "local-db-start": return await executeLocalDatabaseStart(invocation)
      case "public-default-privileges": return await executePublicDefaultPrivileges(invocation)
      case "schema-restore": return await executeSchemaRestore(invocation)
      case "local-catalog-postflight": return await executeCatalogPostflight(invocation)
      case "remote-migration-repair": return await executeRemoteMigrationRepair(invocation)
      case "pending-migrations-copy": return await executePendingMigrationCopy(invocation)
      case "runtime-activation-scan": return await executeRuntimeActivationScan(invocation)
      case "local-migration-push": return await executeLocalMigrationPush(invocation)
      case "synthetic-fixture-install": return await executeSyntheticFixture(invocation)
      case "safety-preflight":
      case "safety-postflight": return await executeSafetyPostflight(invocation)
      case "read-only-evidence":
      case "disposable-round-trip": return await executeEvidenceQuery(invocation)
      case "pgtap": return await executePgTap(invocation)
      case "cleanup": return await executeExactCleanup(invocation)
      default: return failedLocalResult()
    }
  } catch {
    return failedLocalResult()
  }
}

export function createNotificationLocalQaExecutor({ executeProcess } = {}) {
  if (typeof executeProcess !== "function") {
    throw new Error("notification_local_db_executor_refused")
  }
  return async (invocation) => executeNotificationLocalQaInvocation(Object.freeze({
    ...invocation,
    [TRUSTED_PROCESS_EXECUTOR]: executeProcess,
  }))
}

export function assertNotificationSupabaseCliVersion(value) {
  if (typeof value !== "string" || value.trim() !== PINNED_SUPABASE_CLI_VERSION) {
    throw new Error("notification_local_db_supabase_version_refused")
  }
  return PINNED_SUPABASE_CLI_VERSION
}

async function verifyPinnedSupabaseCli(sourceEnvironment, abortSignal) {
  const env = {}
  for (const key of LOCAL_ENV_SOURCE_KEYS) {
    if (typeof sourceEnvironment?.[key] === "string") env[key] = sourceEnvironment[key]
  }
  assertNotificationRunNotAborted(abortSignal)
  const result = await executeBoundedProcess({
    command: DEFAULT_SUPABASE_GO_CLI_PATH,
    args: ["--version"],
    cwd: ROOT,
    env: Object.freeze(env),
    timeoutMs: 30 * 1000,
    maxStdoutBytes: MAX_STATUS_STDOUT_BYTES,
    maxStderrBytes: MAX_STDERR_BYTES,
    abortSignal,
  })
  assertNotificationRunNotAborted(abortSignal)
  if (result.code !== 0) throw new Error("notification_local_db_supabase_version_refused")
  return assertNotificationSupabaseCliVersion(result.stdout)
}

async function removeNotificationRuntimeRoot(tempRoot) {
  try {
    if (
      typeof tempRoot !== "string"
      || !isAbsolute(tempRoot)
      || !isPathInside(resolve(tmpdir()), tempRoot)
      || !basename(tempRoot).startsWith("tips-notification-local-db-")
    ) return false
    await rm(tempRoot, { recursive: true, force: true })
    try {
      await lstat(tempRoot)
      return false
    } catch (error) {
      return error?.code === "ENOENT"
    }
  } catch {
    return false
  }
}

async function prepareNotificationLocalQaContext(context, { abortSignal } = {}) {
  const supplied = [
    context.runtimeManifest,
    context.remoteCollection,
    context.fixtureContract,
    context.sourceEnvironment,
  ]
  if (supplied.every((value) => value !== undefined)) {
    return {
      runtimeManifest: context.runtimeManifest,
      remoteCollection: context.remoteCollection,
      fixtureContract: context.fixtureContract,
      sourceEnvironment: context.sourceEnvironment,
      runEvidence: context.runEvidence,
      ownsTempRoot: false,
    }
  }
  if (supplied.some((value) => value !== undefined)) {
    throw new Error("notification_local_db_execution_context_refused")
  }

  let tempRoot
  try {
    assertNotificationRunNotAborted(abortSignal)
    const { loadNotificationContentLocalQaContract } = await import(
      "./notification-content-local-qa-fixture.mjs"
    )
    const fixtureContract = await loadNotificationContentLocalQaContract()
    assertNotificationRunNotAborted(abortSignal)
    await verifyPinnedSupabaseCli(process.env, abortSignal)
    tempRoot = await mkdtemp(join(resolve(tmpdir()), "tips-notification-local-db-"))
    await chmod(tempRoot, 0o700)
    assertNotificationRunNotAborted(abortSignal)
    const collectorRuntime = await buildNotificationRemoteCollectorRuntime({ tempRoot })
    const collectorCleanupController = createNotificationRemoteCollectorCleanupController({
      runtime: collectorRuntime,
      sourceEnvironment: process.env,
      executeProcess: executeBoundedProcess,
    })
    const remoteCollection = await runNotificationRemoteCollectorWithCleanup({
      collectorContext: {
        approved: true,
        cliPath: DEFAULT_SUPABASE_GO_CLI_PATH,
        artifactRoot: tempRoot,
        linkedProjectMetadata: { project_ref: PARENT_PROJECT_REF, region: ALLOWED_REGION },
        sourceEnvironment: process.env,
        abortSignal,
      },
      collectorRuntime,
      cleanupController: collectorCleanupController,
      execute: executeBoundedProcess,
    })
    assertNotificationRunNotAborted(abortSignal)
    const runtimeManifest = await buildNotificationLocalRuntimeManifest({
      tempRoot,
      migrationCatalog: remoteCollection.migrationManifest.catalog,
      pendingMigrations: remoteCollection.migrationManifest.pending,
      fixtureContract,
    })
    assertNotificationRunNotAborted(abortSignal)
    return {
      runtimeManifest,
      remoteCollection,
      fixtureContract,
      sourceEnvironment: process.env,
      runEvidence: runControlledNotificationContentDbEvidence,
      ownsTempRoot: true,
    }
  } catch (error) {
    const rootCleanupCode = tempRoot === undefined
      ? "notification_local_db_cleanup_not_required"
      : await removeNotificationRuntimeRoot(tempRoot)
        ? "notification_local_db_cleanup_ok"
        : "notification_local_db_cleanup_failed"
    const inheritedCleanupCode = error?.evidence?.cleanupCode
    const cleanupCode = inheritedCleanupCode === "notification_local_db_cleanup_failed"
        || rootCleanupCode === "notification_local_db_cleanup_failed"
      ? "notification_local_db_cleanup_failed"
      : inheritedCleanupCode === "notification_local_db_cleanup_ok"
          || rootCleanupCode === "notification_local_db_cleanup_ok"
        ? "notification_local_db_cleanup_ok"
        : "notification_local_db_cleanup_not_required"
    const rawCode = String(error?.code ?? error?.message ?? "").split(":", 1)[0]
    const primaryCode = abortSignal?.aborted
      ? "notification_local_db_signal_received"
      : safeFailureCode(rawCode, "notification_local_db_preparation_failed")
    throw new NotificationLocalDbQaError(primaryCode, cleanupCode)
  }
}

async function planEvidence() {
  const { loadNotificationContentLocalQaContract } = await import(
    "./notification-content-local-qa-fixture.mjs"
  )
  const fixtureContract = await loadNotificationContentLocalQaContract()

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
      databaseBootstrap: {
        supabaseCliVersion: PINNED_SUPABASE_CLI_VERSION,
        authSchemaMigrator: "one-shot-internal-network",
        steadyStateContainers: ["database"],
      },
      syntheticFixture: {
        settingsRegistry: fixtureContract.manifest.expectedCounts.settingsRegistry,
        rules: fixtureContract.manifest.expectedCounts.rules,
        operationalRows: fixtureContract.manifest.expectedCounts.operationalRows,
      },
      pgTapFileCount: fixtureContract.pgTap.fileCount,
      pgTapFiles: fixtureContract.pgTap.files.map((entry) => entry.relativePath),
      providerEgressBlocked: true,
    },
  }
}

function normalizeLocalExecutionContract(runtimeManifest, remoteCollection, fixtureContract) {
  const manifest = assertNotificationLocalRuntimeManifest(runtimeManifest)
  const expectedSchemaPath = join(manifest.tempRoot, "notification-remote-schema.sql")
  const expectedApplied = manifest.migrationCatalog
    .slice(0, manifest.migrationCatalog.length - manifest.pendingMigrations.length)
    .map(({ version, name }) => ({ version, name }))
  const expectedMigrationManifestCore = {
    version: 2,
    applied: expectedApplied,
    catalog: manifest.migrationCatalog,
    pending: manifest.pendingMigrations,
  }
  if (
    remoteCollection?.project?.projectRef !== PARENT_PROJECT_REF
    || remoteCollection?.project?.region !== ALLOWED_REGION
    || remoteCollection?.remote?.transactionReadOnly !== true
    || !Number.isInteger(remoteCollection?.remote?.postgresMajor)
    || remoteCollection.remote.postgresMajor < 12
    || remoteCollection.remote.postgresMajor > 99
    || remoteCollection?.safety?.rowDataCopied !== 0
    || remoteCollection?.safety?.productionMutationCount !== 0
    || remoteCollection?.artifacts?.schemaDumpPath !== expectedSchemaPath
    || !SHA256_PATTERN.test(remoteCollection?.artifacts?.schemaDumpSha256)
    || JSON.stringify(remoteCollection?.migrationManifest?.pending)
      !== JSON.stringify(manifest.pendingMigrations)
    || JSON.stringify(remoteCollection?.migrationManifest?.catalog)
      !== JSON.stringify(manifest.migrationCatalog)
    || JSON.stringify(remoteCollection?.migrationManifest?.applied)
      !== JSON.stringify(remoteCollection?.remote?.migrations)
    || JSON.stringify(remoteCollection?.migrationManifest?.applied)
      !== JSON.stringify(expectedApplied)
    || remoteCollection?.migrationManifest?.version !== 2
    || remoteCollection?.migrationManifest?.sha256
      !== sha256(JSON.stringify(expectedMigrationManifestCore))
    || fixtureContract?.fixture?.sha256 !== manifest.fixture.sha256
    || fixtureContract?.manifest?.sqlSha256 !== manifest.fixture.sqlSha256
    || fixtureContract?.pgTap?.sha256 !== manifest.pgTap.sha256
    || JSON.stringify(fixtureContract?.pgTap?.files?.map(({ relativePath, sha256: hash }) => ({
      relativePath,
      sha256: hash,
    }))) !== JSON.stringify(manifest.pgTap.files)
    || !isPlainRecord(fixtureContract?.manifest?.expectedCounts)
  ) {
    throw new Error("notification_local_db_execution_contract_refused")
  }
  return deepFreeze({
    appliedMigrations: remoteCollection.migrationManifest.applied.map(({ version, name }) => ({
      version,
      name,
    })),
    schemaDumpPath: expectedSchemaPath,
    schemaDumpSha256: remoteCollection.artifacts.schemaDumpSha256,
    postgresMajor: remoteCollection.remote.postgresMajor,
    fixtureExpectedCounts: { ...fixtureContract.manifest.expectedCounts },
  })
}

function validateSuccessfulStep(step, evidence, context) {
  const manifest = context.runtimeManifest
  switch (step) {
    case "preexisting-resource-check":
      if (
        !isPlainRecord(evidence)
        || !Number.isInteger(evidence.dockerServerMajor)
        || evidence.dockerServerMajor < MINIMUM_DOCKER_SERVER_MAJOR
        || !Number.isInteger(evidence.ownedResourceCount)
        || !Array.isArray(evidence.resources)
      ) {
        throw new Error(STEP_FAILURE_CODES[step])
      }
      if (evidence.ownedResourceCount !== 0 || evidence.resources.length !== 0) {
        throw new Error("notification_local_db_preexisting_resource_refused")
      }
      break
    case "internal-network-create":
      if (
        !/^[a-f0-9]{64}$/u.test(evidence.networkId ?? "")
        || evidence.networkName !== manifest.dockerNetwork.name
        || evidence.driver !== manifest.dockerNetwork.driver
        || evidence.hostBindingIpv4 !== manifest.dockerNetwork.hostBindingIpv4
        || evidence.internal !== true
      ) throw new Error(STEP_FAILURE_CODES[step])
      break
    case "local-db-start":
      if (
        evidence.projectId !== manifest.projectId
        || evidence.databaseHost !== manifest.database.host
        || evidence.databasePort !== manifest.database.port
        || evidence.ownedResourceCount !== 3
        || evidence.serviceContainersRemaining !== 0
        || evidence.started !== true
      ) throw new Error(STEP_FAILURE_CODES[step])
      break
    case "public-default-privileges":
      if (evidence.publicDefaultPrivilegesRevoked !== true) {
        throw new Error(STEP_FAILURE_CODES[step])
      }
      break
    case "schema-restore":
      if (
        evidence.restored !== true
        || evidence.rowDataCopied !== 0
        || evidence.schemaSha256 !== context.executionContract.schemaDumpSha256
      ) throw new Error(STEP_FAILURE_CODES[step])
      break
    case "local-catalog-postflight":
      if (evidence.ownerGrantRlsExtensionChecksPassed !== true) {
        throw new Error(STEP_FAILURE_CODES[step])
      }
      break
    case "remote-migration-repair":
      if (
        JSON.stringify(evidence.stagedCatalog) !== JSON.stringify(
          manifest.migrationCatalog.map(({ fileName }) => fileName),
        )
        || JSON.stringify(evidence.repairedVersions) !== JSON.stringify(
          context.executionContract.appliedMigrations.map(({ version }) => version),
        )
      ) throw new Error(STEP_FAILURE_CODES[step])
      break
    case "pending-migrations-copy":
      if (
        JSON.stringify(evidence.migrationCatalog) !== JSON.stringify(manifest.migrationCatalog)
        || JSON.stringify(evidence.pendingMigrations)
          !== JSON.stringify(manifest.pendingMigrations)
      ) {
        throw new Error(STEP_FAILURE_CODES[step])
      }
      break
    case "runtime-activation-scan":
      if (evidence.unsafeActivationCount !== 0) throw new Error(STEP_FAILURE_CODES[step])
      break
    case "local-migration-push":
      if (
        evidence.dryRunPassed !== true
        || JSON.stringify(evidence.appliedPendingVersions) !== JSON.stringify(
          manifest.pendingMigrations.map(({ version }) => version),
        )
      ) throw new Error(STEP_FAILURE_CODES[step])
      break
    case "synthetic-fixture-install":
      assertFixtureStepEvidence(evidence, context.fixtureContract)
      break
    case "safety-preflight":
    case "safety-postflight":
      assertZeroSafetyEvidence(evidence, STEP_FAILURE_CODES[step])
      break
    case "read-only-evidence":
      if (
        evidence?.mode !== "read-only"
        || !(
          evidence.operationalRows === 0
          || (
            evidence.passed === true
            && evidence.runtimeFlagsAllFalseBefore === true
            && evidence.runtimeFlagsAllFalseAfter === true
            && evidence.connectionValues === "[redacted]"
            && evidence.connectionCount === 0
            && evidence.operationalDeltas?.pendingClaimedSending === 0
            && evidence.operationalDeltas?.inbox === 0
            && evidence.operationalDeltas?.providerAttempts === 0
            && evidence.operationalDeltas?.audit === 0
          )
        )
      ) {
        throw new Error(STEP_FAILURE_CODES[step])
      }
      break
    case "disposable-round-trip":
      if (
        evidence?.mode !== "round-trip"
        || !(
          (
            evidence.mutationTarget === "loopback"
            && evidence.restored === true
            && evidence.residualRows === 0
            && evidence.enabledDispatchFlags === 0
          )
          || (
            evidence.passed === true
            && evidence.runtimeFlagsAllFalseBefore === true
            && evidence.runtimeFlagsAllFalseAfter === true
            && evidence.rolledBack === true
            && evidence.conflictPreserved === true
            && evidence.noOpPreserved === true
            && evidence.fixtureWrites?.ruleRevisionDelta === 1
            && evidence.fixtureWrites?.templateDelta === 1
            && evidence.fixtureWrites?.auditDelta === 1
            && evidence.operationalDeltas?.pendingClaimedSending === 0
            && evidence.operationalDeltas?.inbox === 0
            && evidence.operationalDeltas?.providerAttempts === 0
          )
        )
      ) throw new Error(STEP_FAILURE_CODES[step])
      break
    case "pgtap":
      assertPgTapStepEvidence(evidence, manifest)
      break
    default:
      throw new Error("notification_local_db_step_refused")
  }
  return evidence
}

export function installLocalQaSignalLifecycle(cleanupController, runAbortController) {
  const handlers = {}
  let firstSignal
  for (const signal of ["SIGINT", "SIGTERM"]) {
    handlers[signal] = async () => {
      const evidence = cleanupController.signalHandlers[signal](signal)
      if (firstSignal === undefined) {
        firstSignal = signal
        runAbortController.abort(new Error("notification_local_db_signal_received"))
        process.exitCode = signal === "SIGINT" ? 130 : 143
      }
      return evidence
    }
    process.on(signal, handlers[signal])
  }
  return () => {
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.removeListener(signal, handlers[signal])
    }
  }
}

async function runControlledNotificationContentDbEvidence(options) {
  const { runNotificationContentDbEvidence } = await import(
    "./notification-content-db-evidence.mjs"
  )
  return runNotificationContentDbEvidence({
    mode: options.mode,
    databaseUrl: options.databaseUrl,
    disposable: options.disposable,
    query: options.query,
  })
}

export async function runNotificationIsolatedDbQa(context = {}) {
  if (context.approved !== true) {
    throw new Error("notification_local_db_approval_required")
  }

  const state = {
    localStartAttempted: false,
    signalReceived: false,
    dockerNetworkId: undefined,
  }
  const runAbortController = new AbortController()
  let controller
  const deferredSignalHandler = (signal) => {
    if (controller) return controller.signalHandlers[signal](signal)
    state.signalReceived = true
    return deepFreeze({
      primaryCode: "notification_local_db_signal_received",
      cleanupCode: "notification_local_db_cleanup_deferred",
    })
  }
  const signalBridge = Object.freeze({
    signalHandlers: Object.freeze({
      SIGINT: deferredSignalHandler,
      SIGTERM: deferredSignalHandler,
    }),
  })
  const disposeSignals = installLocalQaSignalLifecycle(signalBridge, runAbortController)
  let prepared
  try {
    prepared = await prepareNotificationLocalQaContext(context, {
      abortSignal: runAbortController.signal,
    })
    assertNotificationRunNotAborted(runAbortController.signal)
  } catch (error) {
    disposeSignals()
    if (state.signalReceived && error?.code !== "notification_local_db_signal_received") {
      throw new NotificationLocalDbQaError(
        "notification_local_db_signal_received",
        error?.evidence?.cleanupCode ?? "notification_local_db_cleanup_not_required",
      )
    }
    throw error
  }
  let manifest
  let environments
  let executionContract
  let execute
  let runEvidence
  try {
    manifest = assertNotificationLocalRuntimeManifest(prepared.runtimeManifest)
    environments = buildNotificationQaChildEnvironments({
      sourceEnvironment: prepared.sourceEnvironment,
      runtimeManifest: manifest,
    })
    executionContract = normalizeLocalExecutionContract(
      manifest,
      prepared.remoteCollection,
      prepared.fixtureContract,
    )
    execute = context.execute ?? executeNotificationLocalQaInvocation
    runEvidence = prepared.runEvidence ?? runControlledNotificationContentDbEvidence
    if (
      typeof execute !== "function"
      || typeof runEvidence !== "function"
      || (context.execute === undefined && prepared.ownsTempRoot !== true)
    ) {
      throw new Error("notification_local_db_executor_refused")
    }
    controller = createNotificationLocalCleanupController({
      runtimeManifest: manifest,
      localEnvironment: environments.local,
      execute,
      state,
    })
    assertNotificationRunNotAborted(runAbortController.signal)
  } catch (error) {
    const cleanupCode = prepared.ownsTempRoot
      ? await removeNotificationRuntimeRoot(prepared.runtimeManifest?.tempRoot)
        ? "notification_local_db_cleanup_ok"
        : "notification_local_db_cleanup_failed"
      : "notification_local_db_cleanup_not_required"
    disposeSignals()
    if (state.signalReceived || cleanupCode === "notification_local_db_cleanup_failed") {
      throw new NotificationLocalDbQaError(
        state.signalReceived
          ? "notification_local_db_signal_received"
          : safeFailureCode(error?.message, "notification_local_db_failed"),
        cleanupCode,
      )
    }
    throw error
  }
  const stepEvidence = {}
  let cleanupRequired = false
  let primaryCode = null
  let cleanupResult = null

  const executeStep = async (step, { sql } = {}) => {
    if (state.signalReceived) throw new Error("notification_local_db_signal_received")
    if (step === "local-db-start") state.localStartAttempted = true
    const invocation = buildNotificationLocalQaInvocation(step, {
      runtimeManifest: manifest,
      localEnvironment: environments.local,
      state,
      sql,
      executionContract,
      abortSignal: runAbortController.signal,
    })
    const result = await execute(invocation)
    const evidence = normalizeInvocationResult(result, STEP_FAILURE_CODES[step])
    const validated = validateSuccessfulStep(step, evidence, {
      runtimeManifest: manifest,
      executionContract,
      fixtureContract: prepared.fixtureContract,
    })
    if (step === "internal-network-create") state.dockerNetworkId = validated.networkId
    return validated
  }

  const executeEvidenceStep = async (step, disposable) => {
    let queryCalls = 0
    const evidence = await runEvidence({
      mode: disposable ? "round-trip" : "read-only",
      databaseUrl: manifest.database.url,
      disposable,
      query: async ({ databaseUrl, sql }) => {
        if (state.signalReceived) throw new Error("notification_local_db_signal_received")
        assertLocalMutationTarget(databaseUrl, manifest.database.port)
        if (queryCalls !== 0 || typeof sql !== "string" || sql.length === 0) {
          throw new Error(STEP_FAILURE_CODES[step])
        }
        queryCalls += 1
        const invocation = buildNotificationLocalQaInvocation(step, {
          runtimeManifest: manifest,
          localEnvironment: environments.local,
          state,
          sql,
          executionContract,
          abortSignal: runAbortController.signal,
        })
        const result = await execute(invocation)
        return normalizeInvocationResult(result, STEP_FAILURE_CODES[step])
      },
    })
    if (queryCalls !== 1) throw new Error(STEP_FAILURE_CODES[step])
    return validateSuccessfulStep(step, evidence, {
      runtimeManifest: manifest,
      executionContract,
      fixtureContract: prepared.fixtureContract,
    })
  }

  try {
    stepEvidence["preexisting-resource-check"] = await executeStep(
      "preexisting-resource-check",
    )
    cleanupRequired = true
    for (const step of LOCAL_ORCHESTRATION_STEPS.slice(1, -1)) {
      stepEvidence[step] = step === "read-only-evidence"
        ? await executeEvidenceStep(step, false)
        : step === "disposable-round-trip"
          ? await executeEvidenceStep(step, true)
          : await executeStep(step)
    }
  } catch (error) {
    primaryCode = state.signalReceived
      ? "notification_local_db_signal_received"
      : safeFailureCode(error?.message, "notification_local_db_failed")
  } finally {
    if (cleanupRequired) cleanupResult = await controller.cleanup()
    else if (prepared.ownsTempRoot) {
      if (await removeNotificationRuntimeRoot(manifest.tempRoot)) {
        cleanupResult = {
          cleanupCode: "notification_local_db_cleanup_ok",
          evidence: {
            ownedResourcesRemaining: 0,
            containersRemaining: 0,
            volumesRemaining: 0,
            networksRemaining: 0,
          },
        }
      } else {
        cleanupResult = { cleanupCode: "notification_local_db_cleanup_failed", evidence: null }
      }
    }
    disposeSignals()
  }

  if (state.signalReceived) primaryCode = "notification_local_db_signal_received"
  const cleanupCode = cleanupResult?.cleanupCode ?? "notification_local_db_cleanup_not_required"
  if (primaryCode || cleanupCode !== "notification_local_db_cleanup_ok") {
    throw new NotificationLocalDbQaError(
      primaryCode ?? "notification_local_db_cleanup_failed",
      cleanupCode,
    )
  }

  const fixtureEvidence = stepEvidence["synthetic-fixture-install"]
  const preflight = stepEvidence["safety-preflight"]
  const postflight = stepEvidence["safety-postflight"]
  const pgTap = stepEvidence.pgtap
  return deepFreeze({
    status: "passed",
    runtimeManifestSha256: manifest.sha256,
    orchestration: {
      steps: LOCAL_ORCHESTRATION_STEPS,
      localStartAttempted: state.localStartAttempted,
    },
    counts: fixtureEvidence.counts,
    pgTap: { fileCount: pgTap.fileCount, passed: pgTap.passed, failed: pgTap.failed },
    safety: {
      productionRowDataCopied: 0,
      productionMutationCount: 0,
      providerEgressBlocked: preflight.egressBlocked && postflight.egressBlocked,
      workerProcesses: Math.max(preflight.workerProcesses, postflight.workerProcesses),
      queueDelta: postflight.queueRows - preflight.queueRows,
      preflightEnabledDispatchFlags: preflight.enabledDispatchFlags,
      postflightEnabledDispatchFlags: postflight.enabledDispatchFlags,
    },
    cleanup: {
      attempts: controller.attempts,
      ...cleanupResult.evidence,
    },
  })
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    process.stdout.write(`${JSON.stringify(await planEvidence(), null, 2)}\n`)
    return
  }

  const approved = args.length === 2
    && args.includes("--execute")
    && args.includes("--approved-local-db")

  if (!approved) throw new Error("notification_local_db_approval_required")
  const evidence = await runNotificationIsolatedDbQa({ approved: true })
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    const failure = isPlainRecord(error?.evidence)
      ? error.evidence
      : { primaryCode: safeFailureCode(error?.message, "notification_local_db_failed") }
    process.stderr.write(`${JSON.stringify(failure)}\n`)
    if (failure.primaryCode !== "notification_local_db_signal_received") {
      process.exitCode = 1
    }
  })
}
