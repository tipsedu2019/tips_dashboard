import { spawn } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ACTIVE_PREVIEW_STATUSES = new Set(["ACTIVE_HEALTHY"])
const PROJECT_REF_PATTERN = /^[a-z]{20}$/
const QA_BRANCH_NAME_PATTERN = /^qa-notification-content-\d{14}$/
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const PARENT_PROJECT_REF = "slnjqlzzhewblvttiidk"
const LOCAL_PROJECT_ID = "tips_notification_db_qa"
const LOCAL_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
const PGTAP_DATABASE_URL = "postgresql://postgres:postgres@host.docker.internal:54322/postgres"
const DEFAULT_CLI_PATH = "/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase"
const PENDING_PREVIEW_STATUSES = new Set(["CREATING_PROJECT", "CREATING", "COMING_UP"])
const PGTAP_FILES = Object.freeze([
  "supabase/tests/notification_control_plane_schema_test.sql",
  "supabase/tests/notification_content_contract_test.sql",
  "supabase/tests/notification_makeup_single_writer_test.sql",
  "supabase/tests/notification_control_plane_runtime_test.sql",
  "supabase/tests/notification_ops_task_adapters_test.sql",
  "supabase/tests/notification_registration_handoffs_test.sql",
  "supabase/tests/notification_transfer_withdrawal_adapters_test.sql",
  "supabase/tests/notification_makeup_adapter_test.sql",
  "supabase/tests/notification_approval_adapter_test.sql",
])
const SAFE_ENV_KEYS = Object.freeze([
  "DOCKER_HOST",
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "SUPABASE_ACCESS_TOKEN",
  "TMPDIR",
  "USER",
])
const BASE_PREFLIGHT_KEYS = Object.freeze(["auth_users", "profiles", "students", "classes"])
const FULL_PREFLIGHT_KEYS = Object.freeze([
  ...BASE_PREFLIGHT_KEYS,
  "deliveries",
  "inbox",
  "runtime_flags_enabled",
  "connection_secret_rows",
])

const RELATION_PREFLIGHT_SQL = `begin read only;
select jsonb_build_object(
  'auth_users', to_regclass('auth.users') is not null,
  'profiles', to_regclass('public.profiles') is not null,
  'students', to_regclass('public.students') is not null,
  'classes', to_regclass('public.classes') is not null
) as notification_preview_relations;
rollback;
`

const FULL_PREFLIGHT_SQL = `begin read only;
select jsonb_build_object(
  'auth_users', (select count(*) from auth.users),
  'profiles', (select count(*) from public.profiles),
  'students', (select count(*) from public.students),
  'classes', (select count(*) from public.classes),
  'deliveries', coalesce((select count(*) from dashboard_private.notification_deliveries), 0),
  'inbox', coalesce((select count(*) from public.dashboard_notifications), 0),
  'runtime_flags_enabled', coalesce((
    select count(*) from dashboard_private.notification_runtime_flags where enabled
  ), 0),
  'connection_secret_rows', coalesce((
    select count(*) from public.google_chat_webhook_settings
    where nullif(btrim(webhook_url), '') is not null
       or webhook_url_ciphertext is not null
  ), 0)
) as notification_preview_preflight;
rollback;
`

function hasSafeBranchFieldTypes(branch) {
  return branch
    && typeof branch === "object"
    && typeof branch.id === "string"
    && branch.id.length > 0
    && typeof branch.name === "string"
    && branch.name.length > 0
    && typeof branch.projectRef === "string"
    && PROJECT_REF_PATTERN.test(branch.projectRef)
    && typeof branch.parentProjectRef === "string"
    && PROJECT_REF_PATTERN.test(branch.parentProjectRef)
    && typeof branch.isDefault === "boolean"
    && typeof branch.persistent === "boolean"
    && typeof branch.withData === "boolean"
    && typeof branch.status === "string"
    && branch.status.length > 0
}

function toSafePreviewBranch(branch) {
  return Object.freeze({
    id: branch.id,
    name: branch.name,
    projectRef: branch.projectRef,
    parentProjectRef: branch.parentProjectRef,
    isDefault: branch.isDefault,
    persistent: branch.persistent,
    withData: branch.withData,
    status: branch.status,
  })
}

export function normalizePreviewBranchList(payload) {
  const rawBranches = Array.isArray(payload)
    ? payload
    : payload?.branches

  if (!Array.isArray(rawBranches)) {
    throw new Error("notification_preview_branch_list_invalid")
  }

  const branches = rawBranches.map((rawBranch) => {
    const branch = {
      id: rawBranch?.id,
      name: rawBranch?.name,
      projectRef: rawBranch?.project_ref,
      parentProjectRef: rawBranch?.parent_project_ref,
      isDefault: rawBranch?.is_default,
      persistent: rawBranch?.persistent,
      withData: rawBranch?.with_data,
      status: rawBranch?.status,
    }

    if (!hasSafeBranchFieldTypes(branch)) {
      throw new Error("notification_preview_branch_list_invalid")
    }

    return toSafePreviewBranch(branch)
  })

  return Object.freeze(branches)
}

export function assertDisposablePreviewBranch(branch, parentProjectRef) {
  const valid = PROJECT_REF_PATTERN.test(parentProjectRef)
    && hasSafeBranchFieldTypes(branch)
    && QA_BRANCH_NAME_PATTERN.test(branch.name)
    && branch.parentProjectRef === parentProjectRef
    && branch.projectRef !== parentProjectRef
    && branch.isDefault === false
    && branch.persistent === false
    && branch.withData === false
    && ACTIVE_PREVIEW_STATUSES.has(branch.status)

  if (!valid) {
    throw new Error("notification_preview_branch_refused")
  }

  return toSafePreviewBranch(branch)
}

export function redactCommandEvidence(value) {
  return String(value)
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi, (match) => {
      try {
        const url = new URL(match)
        return `${url.protocol}//[redacted]@${url.host}${url.pathname}`
      } catch {
        return "[redacted]"
      }
    })
    .replace(/\bsbp_[A-Za-z0-9_-]+\b/g, "[redacted]")
    .replace(/https:\/\/chat\.googleapis\.com\/[^\s"'<>]+/gi, (match) => {
      try {
        const url = new URL(match)
        const redactedQuery = url.search ? "?[redacted]" : ""
        return `${url.origin}${url.pathname}${redactedQuery}`
      } catch {
        return "[redacted]"
      }
    })
}

export function buildPreviewBranchName(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error("notification_preview_branch_time_invalid")
  }

  const stamp = [
    now.getUTCFullYear(),
    now.getUTCMonth() + 1,
    now.getUTCDate(),
    now.getUTCHours(),
    now.getUTCMinutes(),
    now.getUTCSeconds(),
  ].map((part, index) => index === 0 ? String(part) : String(part).padStart(2, "0")).join("")

  return `qa-notification-content-${stamp}`
}

function safeExecutionEnvironment(extra = {}) {
  const environment = {}
  for (const key of SAFE_ENV_KEYS) {
    if (typeof process.env[key] === "string") environment[key] = process.env[key]
  }
  return { ...environment, ...extra }
}

function executeProcess({ command, args, cwd, env }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    const stdout = []
    const stderr = []
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill("SIGTERM")
      rejectPromise(new Error("notification_preview_child_process_timeout"))
    }, 20 * 60 * 1000)

    child.stdout.on("data", (chunk) => stdout.push(chunk))
    child.stderr.on("data", (chunk) => stderr.push(chunk))
    child.on("error", () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      rejectPromise(new Error("notification_preview_child_process_failed"))
    })
    child.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolvePromise({
        code: Number.isInteger(code) ? code : 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      })
    })
  })
}

function sameInvocation(left, right) {
  return left.command === right.command
    && left.cwd === right.cwd
    && left.args.length === right.args.length
    && left.args.every((value, index) => value === right.args[index])
}

function allowedInvocations(context) {
  const cli = (args, cwd = ROOT) => ({ command: context.cliPath, args, cwd })
  const node = (args, cwd = ROOT) => ({ command: context.nodePath, args, cwd })
  const allowed = [
    cli(["branches", "list", "--project-ref", PARENT_PROJECT_REF, "--output-format", "json"]),
    cli([
      "branches", "create", context.branchName,
      "--project-ref", PARENT_PROJECT_REF,
      "--region", "ap-northeast-2",
      "--size", "nano",
      "--output-format", "json",
    ]),
    cli(["db", "start"], context.localWorkdir),
    cli(["stop", "--project-id", LOCAL_PROJECT_ID, "--no-backup"], context.localWorkdir),
  ]

  if (context.branchIdentifier) {
    allowed.push(
      cli([
        "branches", "get", context.branchIdentifier,
        "--project-ref", PARENT_PROJECT_REF,
        "--output-format", "json",
      ]),
      cli([
        "branches", "delete", context.branchIdentifier,
        "--project-ref", PARENT_PROJECT_REF,
        "--yes",
      ]),
    )
  }

  if (context.databaseUrl) {
    allowed.push(
      cli([
        "db", "query", "--db-url", context.databaseUrl,
        "--file", context.relationPreflightFile,
        "--output", "json",
      ]),
      cli([
        "db", "query", "--db-url", context.databaseUrl,
        "--file", context.basePreflightFile,
        "--output", "json",
      ]),
      cli([
        "db", "query", "--db-url", context.databaseUrl,
        "--file", context.fullPreflightFile,
        "--output", "json",
      ]),
      cli(["db", "push", "--db-url", context.databaseUrl, "--dry-run", "--include-all"]),
      cli(["db", "push", "--db-url", context.databaseUrl, "--include-all"]),
      cli(["migration", "list", "--db-url", context.databaseUrl]),
      cli([
        "db", "dump", "--db-url", context.databaseUrl,
        "--schema", "public,dashboard_private",
        "--file", context.schemaDumpFile,
      ]),
      cli([
        "db", "dump", "--db-url", context.databaseUrl,
        "--schema", "public,dashboard_private",
        "--data-only", "--use-copy",
        "--file", context.dataDumpFile,
      ]),
    )
  }

  allowed.push(
    cli([
      "db", "query", "--db-url", LOCAL_DATABASE_URL,
      "--file", context.schemaDumpFile,
    ], context.localWorkdir),
    cli([
      "db", "query", "--db-url", LOCAL_DATABASE_URL,
      "--file", context.dataDumpFile,
    ], context.localWorkdir),
    node([
      resolve(ROOT, "scripts/notification-content-db-evidence.mjs"),
      "--mode", "read-only",
      "--db-url", LOCAL_DATABASE_URL,
    ]),
    node([
      resolve(ROOT, "scripts/notification-content-db-evidence.mjs"),
      "--mode", "round-trip",
      "--db-url", LOCAL_DATABASE_URL,
      "--disposable",
    ]),
    cli(["test", "db", "--db-url", PGTAP_DATABASE_URL, ...PGTAP_FILES]),
  )

  return allowed
}

async function runAllowedCommand(step, invocation, context, execute) {
  if (!allowedInvocations(context).some((allowed) => sameInvocation(allowed, invocation))) {
    throw new Error("notification_preview_command_refused")
  }

  let result
  try {
    result = await execute({
      command: invocation.command,
      args: Object.freeze([...invocation.args]),
      cwd: invocation.cwd,
      env: invocation.env || safeExecutionEnvironment(),
    })
  } catch {
    throw new Error(`notification_preview_command_failed:${step}`)
  }

  if (!result || Number(result.code) !== 0) {
    throw new Error(`notification_preview_command_failed:${step}`)
  }
  return {
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
  }
}

function parseJsonOutput(value, errorCode) {
  const source = String(value || "").trim()
  try {
    return JSON.parse(source)
  } catch {
    const lines = source.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(lines[index])
      } catch {
        // Continue looking for the final structured CLI line.
      }
    }
    throw new Error(errorCode)
  }
}

function normalizeSinglePreviewBranch(payload) {
  const candidate = payload?.branch || payload
  const branches = normalizePreviewBranchList([candidate])
  if (branches.length !== 1) throw new Error("notification_preview_branch_contract_invalid")
  return branches[0]
}

function assertCreatedPreviewIdentity(branch, expectedName) {
  const valid = branch.name === expectedName
    && branch.parentProjectRef === PARENT_PROJECT_REF
    && branch.projectRef !== PARENT_PROJECT_REF
    && branch.isDefault === false
    && branch.persistent === false
    && branch.withData === false
  if (!valid) throw new Error("notification_preview_branch_refused")
  return branch
}

function extractPreviewDatabaseUrl(payload) {
  const candidates = [
    payload?.POSTGRES_URL_NON_POOLING,
    payload?.postgres_url_non_pooling,
    payload?.branch?.POSTGRES_URL_NON_POOLING,
    payload?.branch?.postgres_url_non_pooling,
  ]
  const value = candidates.find((candidate) => typeof candidate === "string" && candidate.length > 0)
  if (!value) throw new Error("notification_preview_database_url_missing")
  return value
}

function assertPreviewDatabaseTarget(value, branchProjectRef) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error("notification_preview_database_url_invalid")
  }
  const productionHost = `db.${PARENT_PROJECT_REF}.supabase.co`
  const previewHost = `db.${branchProjectRef}.supabase.co`
  if (parsed.hostname === productionHost) {
    throw new Error("notification_preview_production_target_refused")
  }
  if (!/^postgres(?:ql)?:$/u.test(parsed.protocol) || parsed.hostname !== previewHost) {
    throw new Error("notification_preview_database_target_refused")
  }
  return value
}

function findNamedValue(value, key) {
  if (!value || typeof value !== "object") return null
  if (Object.prototype.hasOwnProperty.call(value, key)) return value[key]
  for (const candidate of Array.isArray(value) ? value : Object.values(value)) {
    const found = findNamedValue(candidate, key)
    if (found !== null) return found
  }
  return null
}

function parseBaseRelationPresence(stdout) {
  const payload = parseJsonOutput(stdout, "notification_preview_relations_invalid")
  let relations = findNamedValue(payload, "notification_preview_relations")
  if (typeof relations === "string") {
    relations = parseJsonOutput(relations, "notification_preview_relations_invalid")
  }
  if (!relations || typeof relations !== "object") {
    throw new Error("notification_preview_relations_invalid")
  }
  for (const key of BASE_PREFLIGHT_KEYS) {
    if (typeof relations[key] !== "boolean") {
      throw new Error("notification_preview_relations_invalid")
    }
  }
  if (relations.auth_users !== true) {
    throw new Error("notification_preview_relations_invalid")
  }
  return relations
}

function buildBasePreflightSql(relations) {
  const countExpression = (present, relation) => present
    ? `(select count(*) from ${relation})`
    : "0"
  return `begin read only;
select jsonb_build_object(
  'auth_users', ${countExpression(relations.auth_users, "auth.users")},
  'profiles', ${countExpression(relations.profiles, "public.profiles")},
  'students', ${countExpression(relations.students, "public.students")},
  'classes', ${countExpression(relations.classes, "public.classes")}
) as notification_preview_preflight;
rollback;
`
}

function parsePreflightCounts(stdout, requiredKeys) {
  const payload = parseJsonOutput(stdout, "notification_preview_preflight_invalid")
  let counts = findNamedValue(payload, "notification_preview_preflight")
  if (typeof counts === "string") {
    counts = parseJsonOutput(counts, "notification_preview_preflight_invalid")
  }
  if (!counts || typeof counts !== "object") {
    throw new Error("notification_preview_preflight_invalid")
  }
  for (const key of requiredKeys) {
    if (!Number.isSafeInteger(counts[key]) || counts[key] !== 0) {
      throw new Error("notification_preview_data_not_empty")
    }
  }
  return counts
}

function assertNoRuntimeActivation(value) {
  const source = String(value || "")
  const runtimeFlagInsert = /insert\s+into\s+dashboard_private\.notification_runtime_flags[\s\S]*?values([\s\S]*?);/giu
  const runtimeFlagUpdate = /update\s+dashboard_private\.notification_runtime_flags[\s\S]*?set\s+enabled\s*=\s*true/iu
  const insertsEnabled = [...source.matchAll(runtimeFlagInsert)]
    .some((match) => /\btrue\b/iu.test(match[1]))
  if (
    /notification_worker_schedule/iu.test(source)
    || /cron\.schedule\s*\(/iu.test(source)
    || runtimeFlagUpdate.test(source)
    || insertsEnabled
  ) {
    throw new Error("notification_preview_runtime_activation_refused")
  }
}

async function assertLocalMigrationsDoNotActivateRuntime() {
  const migrationsDirectory = resolve(ROOT, "supabase/migrations")
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort()
  for (const name of migrationFiles) {
    assertNoRuntimeActivation(await readFile(resolve(migrationsDirectory, name), "utf8"))
  }
}

function command(command, args, cwd = ROOT, env) {
  return { command, args, cwd, env }
}

async function prepareRuntimeFiles(tempRoot) {
  const localWorkdir = resolve(tempRoot, "local")
  const localSupabaseDirectory = resolve(localWorkdir, "supabase")
  const paths = {
    localWorkdir,
    relationPreflightFile: resolve(tempRoot, "notification-preview-relations.sql"),
    basePreflightFile: resolve(tempRoot, "notification-preview-preflight-base.sql"),
    fullPreflightFile: resolve(tempRoot, "notification-preview-preflight-full.sql"),
    schemaDumpFile: resolve(tempRoot, "notification-preview-schema.sql"),
    dataDumpFile: resolve(tempRoot, "notification-preview-data.sql"),
  }
  await mkdir(resolve(localSupabaseDirectory, "migrations"), { recursive: true })
  await Promise.all([
    writeFile(paths.relationPreflightFile, RELATION_PREFLIGHT_SQL, { encoding: "utf8", mode: 0o600 }),
    writeFile(paths.basePreflightFile, "", { encoding: "utf8", mode: 0o600 }),
    writeFile(paths.fullPreflightFile, FULL_PREFLIGHT_SQL, { encoding: "utf8", mode: 0o600 }),
    writeFile(paths.schemaDumpFile, "", { encoding: "utf8", mode: 0o600 }),
    writeFile(paths.dataDumpFile, "", { encoding: "utf8", mode: 0o600 }),
    writeFile(resolve(localSupabaseDirectory, "config.toml"), [
      `project_id = "${LOCAL_PROJECT_ID}"`,
      "",
      "[db]",
      "port = 54322",
      "major_version = 17",
      "",
    ].join("\n"), { encoding: "utf8", mode: 0o600 }),
  ])
  return paths
}

function planEvidence() {
  return Object.freeze({
    mode: "plan",
    approved: false,
    requiredFlags: Object.freeze(["--execute", "--approved-preview-branch"]),
    expectedResources: Object.freeze({
      previewBranches: 1,
      productionDataCopied: false,
      persistent: false,
      localDatabaseProjectId: LOCAL_PROJECT_ID,
    }),
  })
}

export async function runNotificationIsolatedDbQa({
  approved = false,
  cliPath = DEFAULT_CLI_PATH,
  nodePath = process.execPath,
  now = new Date(),
  execute = executeProcess,
  wait = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
} = {}) {
  if (approved !== true) throw new Error("notification_preview_approval_required")
  if (typeof execute !== "function" || typeof wait !== "function") {
    throw new Error("notification_preview_executor_invalid")
  }
  if (basename(cliPath) !== "supabase" || basename(nodePath) !== "node") {
    throw new Error("notification_preview_tool_path_refused")
  }

  const branchName = buildPreviewBranchName(now)
  const tempRoot = await mkdtemp(resolve(tmpdir(), "tips-notification-db-qa-"))
  const paths = await prepareRuntimeFiles(tempRoot)
  const context = {
    cliPath,
    nodePath,
    branchName,
    branchIdentifier: null,
    databaseUrl: null,
    ...paths,
  }
  const cleanup = {
    previewBranchDeleted: false,
    localDatabaseStopped: false,
    tempDirectoryRemoved: false,
  }
  let localStarted = false
  let branch = null
  let fullCounts = null
  let readOnlyPassed = false
  let roundTripPassed = false
  let pgTapPassed = false

  try {
    const listResult = await runAllowedCommand(
      "branches-list",
      command(cliPath, [
        "branches", "list", "--project-ref", PARENT_PROJECT_REF, "--output-format", "json",
      ]),
      context,
      execute,
    )
    const existingBranches = normalizePreviewBranchList(parseJsonOutput(
      listResult.stdout,
      "notification_preview_branch_list_invalid",
    ))
    if (existingBranches.some((candidate) => candidate.name === branchName)) {
      throw new Error("notification_preview_branch_name_conflict")
    }

    const createResult = await runAllowedCommand(
      "branches-create",
      command(cliPath, [
        "branches", "create", branchName,
        "--project-ref", PARENT_PROJECT_REF,
        "--region", "ap-northeast-2",
        "--size", "nano",
        "--output-format", "json",
      ]),
      context,
      execute,
    )
    context.branchIdentifier = branchName
    branch = assertCreatedPreviewIdentity(normalizeSinglePreviewBranch(parseJsonOutput(
      createResult.stdout,
      "notification_preview_branch_contract_invalid",
    )), branchName)
    context.branchIdentifier = branch.projectRef

    let getPayload
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const getResult = await runAllowedCommand(
        "branches-get",
        command(cliPath, [
          "branches", "get", context.branchIdentifier,
          "--project-ref", PARENT_PROJECT_REF,
          "--output-format", "json",
        ]),
        context,
        execute,
      )
      getPayload = parseJsonOutput(getResult.stdout, "notification_preview_branch_contract_invalid")
      const candidate = assertCreatedPreviewIdentity(normalizeSinglePreviewBranch(getPayload), branchName)
      if (candidate.projectRef !== branch.projectRef) {
        throw new Error("notification_preview_branch_refused")
      }
      if (ACTIVE_PREVIEW_STATUSES.has(candidate.status)) {
        branch = assertDisposablePreviewBranch(candidate, PARENT_PROJECT_REF)
        break
      }
      if (!PENDING_PREVIEW_STATUSES.has(candidate.status)) {
        throw new Error("notification_preview_branch_unhealthy")
      }
      if (attempt === 39) throw new Error("notification_preview_branch_timeout")
      await wait(15_000)
    }

    context.databaseUrl = assertPreviewDatabaseTarget(
      extractPreviewDatabaseUrl(getPayload),
      branch.projectRef,
    )

    const relationPreflight = await runAllowedCommand(
      "preflight-relations",
      command(cliPath, [
        "db", "query", "--db-url", context.databaseUrl,
        "--file", context.relationPreflightFile,
        "--output", "json",
      ]),
      context,
      execute,
    )
    const baseRelations = parseBaseRelationPresence(relationPreflight.stdout)
    await writeFile(context.basePreflightFile, buildBasePreflightSql(baseRelations), {
      encoding: "utf8",
      mode: 0o600,
    })
    const basePreflight = await runAllowedCommand(
      "preflight-base",
      command(cliPath, [
        "db", "query", "--db-url", context.databaseUrl,
        "--file", context.basePreflightFile,
        "--output", "json",
      ]),
      context,
      execute,
    )
    parsePreflightCounts(basePreflight.stdout, BASE_PREFLIGHT_KEYS)

    await assertLocalMigrationsDoNotActivateRuntime()
    const dryRun = await runAllowedCommand(
      "migration-dry-run",
      command(cliPath, [
        "db", "push", "--db-url", context.databaseUrl, "--dry-run", "--include-all",
      ]),
      context,
      execute,
    )
    assertNoRuntimeActivation(`${dryRun.stdout}\n${dryRun.stderr}`)

    await runAllowedCommand(
      "migration-apply",
      command(cliPath, ["db", "push", "--db-url", context.databaseUrl, "--include-all"]),
      context,
      execute,
    )
    await runAllowedCommand(
      "migration-list",
      command(cliPath, ["migration", "list", "--db-url", context.databaseUrl]),
      context,
      execute,
    )

    const fullPreflight = await runAllowedCommand(
      "preflight-full",
      command(cliPath, [
        "db", "query", "--db-url", context.databaseUrl,
        "--file", context.fullPreflightFile,
        "--output", "json",
      ]),
      context,
      execute,
    )
    fullCounts = parsePreflightCounts(fullPreflight.stdout, FULL_PREFLIGHT_KEYS)

    await runAllowedCommand(
      "schema-dump",
      command(cliPath, [
        "db", "dump", "--db-url", context.databaseUrl,
        "--schema", "public,dashboard_private",
        "--file", context.schemaDumpFile,
      ]),
      context,
      execute,
    )
    await chmod(context.schemaDumpFile, 0o600)
    await runAllowedCommand(
      "data-dump",
      command(cliPath, [
        "db", "dump", "--db-url", context.databaseUrl,
        "--schema", "public,dashboard_private",
        "--data-only", "--use-copy",
        "--file", context.dataDumpFile,
      ]),
      context,
      execute,
    )
    await chmod(context.dataDumpFile, 0o600)

    await runAllowedCommand(
      "local-db-start",
      command(cliPath, ["db", "start"], context.localWorkdir),
      context,
      execute,
    )
    localStarted = true
    await runAllowedCommand(
      "local-schema-restore",
      command(cliPath, [
        "db", "query", "--db-url", LOCAL_DATABASE_URL,
        "--file", context.schemaDumpFile,
      ], context.localWorkdir),
      context,
      execute,
    )
    await runAllowedCommand(
      "local-data-restore",
      command(cliPath, [
        "db", "query", "--db-url", LOCAL_DATABASE_URL,
        "--file", context.dataDumpFile,
      ], context.localWorkdir),
      context,
      execute,
    )

    const evidenceEnvironment = safeExecutionEnvironment({
      NOTIFICATION_CONTENT_DB_SCOPE: "local",
      SUPABASE_CLI_PATH: cliPath,
    })
    delete evidenceEnvironment.SUPABASE_ACCESS_TOKEN
    const evidenceScript = resolve(ROOT, "scripts/notification-content-db-evidence.mjs")
    const readOnlyResult = await runAllowedCommand(
      "local-read-only-evidence",
      command(nodePath, [
        evidenceScript,
        "--mode", "read-only",
        "--db-url", LOCAL_DATABASE_URL,
      ], ROOT, evidenceEnvironment),
      context,
      execute,
    )
    readOnlyPassed = parseJsonOutput(
      readOnlyResult.stdout,
      "notification_preview_read_only_evidence_invalid",
    )?.passed === true
    if (!readOnlyPassed) throw new Error("notification_preview_read_only_evidence_invalid")

    const roundTripResult = await runAllowedCommand(
      "local-round-trip-evidence",
      command(nodePath, [
        evidenceScript,
        "--mode", "round-trip",
        "--db-url", LOCAL_DATABASE_URL,
        "--disposable",
      ], ROOT, evidenceEnvironment),
      context,
      execute,
    )
    roundTripPassed = parseJsonOutput(
      roundTripResult.stdout,
      "notification_preview_round_trip_evidence_invalid",
    )?.passed === true
    if (!roundTripPassed) throw new Error("notification_preview_round_trip_evidence_invalid")

    await runAllowedCommand(
      "notification-pgtap",
      command(cliPath, ["test", "db", "--db-url", PGTAP_DATABASE_URL, ...PGTAP_FILES]),
      context,
      execute,
    )
    pgTapPassed = true
  } finally {
    let cleanupFailed = false
    if (localStarted) {
      try {
        await runAllowedCommand(
          "local-db-stop",
          command(cliPath, ["stop", "--project-id", LOCAL_PROJECT_ID, "--no-backup"], context.localWorkdir),
          context,
          execute,
        )
        cleanup.localDatabaseStopped = true
      } catch {
        cleanupFailed = true
      }
    }
    if (context.branchIdentifier) {
      try {
        await runAllowedCommand(
          "branches-delete",
          command(cliPath, [
            "branches", "delete", context.branchIdentifier,
            "--project-ref", PARENT_PROJECT_REF,
            "--yes",
          ]),
          context,
          execute,
        )
        cleanup.previewBranchDeleted = true
      } catch {
        cleanupFailed = true
      }
    }
    try {
      await rm(tempRoot, { recursive: true, force: true })
      cleanup.tempDirectoryRemoved = true
    } catch {
      cleanupFailed = true
    }
    if (cleanupFailed) throw new Error("notification_preview_cleanup_failed")
  }

  return Object.freeze({
    branchName: branch.name,
    branchRefPrefix: branch.projectRef.slice(0, 6),
    runtimeFlagsEnabled: Number(fullCounts.runtime_flags_enabled),
    zeroCounts: Object.freeze({
      authUsers: Number(fullCounts.auth_users),
      profiles: Number(fullCounts.profiles),
      students: Number(fullCounts.students),
      classes: Number(fullCounts.classes),
      deliveries: Number(fullCounts.deliveries),
      inbox: Number(fullCounts.inbox),
      connectionSecretRows: Number(fullCounts.connection_secret_rows),
    }),
    localDatabase: Object.freeze({
      readOnlyPassed,
      roundTripPassed,
    }),
    pgTap: Object.freeze({
      passed: pgTapPassed,
      fileCount: PGTAP_FILES.length,
    }),
    cleanup: Object.freeze(cleanup),
  })
}

async function main() {
  const executeRequested = process.argv.includes("--execute")
  const approvalProvided = process.argv.includes("--approved-preview-branch")
  if (!executeRequested && !approvalProvided) {
    process.stdout.write(`${JSON.stringify(planEvidence(), null, 2)}\n`)
    return
  }
  if (!executeRequested || !approvalProvided) {
    throw new Error("notification_preview_approval_required")
  }
  const evidence = await runNotificationIsolatedDbQa({ approved: true })
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "notification_preview_qa_failed"}\n`)
    process.exitCode = 1
  })
}
