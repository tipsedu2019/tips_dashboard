import { readdir, readFile, writeFile } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const MIGRATION_VERSION_PATTERN = /^(\d{14})_.+\.sql$/
const TRANSACTION_CONTROL_PATTERN = /^(?:begin\b|start\s+transaction\b|commit\b|end\b|rollback\b|abort\b)/i

function fail(code) {
  throw new Error(code)
}

function resolveInsideRepo(repoRoot, candidate) {
  const root = resolve(repoRoot)
  const target = resolve(root, candidate)
  const rel = relative(root, target)
  if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) {
    fail("transactional_preflight_path_outside_repo")
  }
  return target
}

function migrationLedgerState(ledger) {
  const rows = String(ledger)
    .split(/\r?\n/)
    .map((line) => line.split("|").slice(0, 2).map((value) => value?.trim() ?? ""))
    .map(([local, remote]) => ({
      local: /^\d{14}$/.test(local) ? local : null,
      remote: /^\d{14}$/.test(remote) ? remote : null,
    }))
    .filter(({ local, remote }) => local !== null || remote !== null)

  const remoteVersions = rows
    .map(({ remote }) => remote)
    .filter(Boolean)
    .sort()
  if (remoteVersions.length === 0) {
    fail("transactional_preflight_remote_ledger_missing")
  }
  if (rows.some(({ local, remote }) => remote && (!local || local !== remote))) {
    fail("transactional_preflight_remote_history_drift")
  }

  const remoteMaxVersion = remoteVersions.at(-1)
  if (rows.some(({ local, remote }) => local && !remote && local <= remoteMaxVersion)) {
    fail("transactional_preflight_unapplied_legacy_migration")
  }

  const pendingVersions = rows
    .filter(({ local, remote }) => local && !remote && local > remoteMaxVersion)
    .map(({ local }) => local)
    .sort()
  if (new Set(pendingVersions).size !== pendingVersions.length) {
    fail("transactional_preflight_pending_ledger_mismatch")
  }
  return { pendingVersions, remoteMaxVersion }
}

function maskSqlOpaqueRegions(source) {
  const masked = [...String(source)]
  const blank = (start, end) => {
    for (let cursor = start; cursor < end; cursor += 1) {
      if (masked[cursor] !== "\n" && masked[cursor] !== "\r") masked[cursor] = " "
    }
  }
  let index = 0

  while (index < source.length) {
    if (source.startsWith("--", index)) {
      const start = index
      const newline = source.indexOf("\n", index + 2)
      index = newline < 0 ? source.length : newline
      blank(start, index)
      continue
    }
    if (source.startsWith("/*", index)) {
      const start = index
      let depth = 1
      index += 2
      while (index < source.length && depth > 0) {
        if (source.startsWith("/*", index)) {
          depth += 1
          index += 2
        } else if (source.startsWith("*/", index)) {
          depth -= 1
          index += 2
        } else {
          index += 1
        }
      }
      if (depth !== 0) fail("transactional_preflight_sql_lexical_invalid")
      blank(start, index)
      continue
    }

    const character = source[index]
    if (character === "'") {
      const start = index
      const prefix = source[index - 1]
      const prefixBefore = source[index - 2]
      const escapeString = /[eE]/.test(prefix ?? "") && !/[A-Za-z0-9_$]/.test(prefixBefore ?? "")
      index += 1
      let closed = false
      while (index < source.length) {
        if (escapeString && source[index] === "\\") {
          index += 2
        } else if (source[index] === "'" && source[index + 1] === "'") {
          index += 2
        } else if (source[index] === "'") {
          index += 1
          closed = true
          break
        } else {
          index += 1
        }
      }
      if (!closed) fail("transactional_preflight_sql_lexical_invalid")
      blank(start, index)
      continue
    }
    if (character === '"') {
      const start = index
      index += 1
      let closed = false
      while (index < source.length) {
        if (source[index] === '"' && source[index + 1] === '"') {
          index += 2
        } else if (source[index] === '"') {
          index += 1
          closed = true
          break
        } else {
          index += 1
        }
      }
      if (!closed) fail("transactional_preflight_sql_lexical_invalid")
      blank(start, index)
      continue
    }
    if (character === "$") {
      const delimiter = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0]
      if (delimiter) {
        const start = index
        const bodyEnd = source.indexOf(delimiter, index + delimiter.length)
        if (bodyEnd < 0) fail("transactional_preflight_sql_lexical_invalid")
        index = bodyEnd + delimiter.length
        blank(start, index)
        continue
      }
    }
    index += 1
  }

  return masked.join("")
}

function sqlStatements(source) {
  const masked = maskSqlOpaqueRegions(source)
  if (masked.split(/\r?\n/).some((line) => /^\s*\\/.test(line))) {
    fail("transactional_preflight_migration_escape_forbidden")
  }

  const statements = []
  let start = 0
  for (let index = 0; index < masked.length; index += 1) {
    if (masked[index] !== ";") continue
    const normalized = masked.slice(start, index).trim().replace(/\s+/g, " ").toLowerCase()
    if (normalized) statements.push({ start, end: index + 1, normalized })
    start = index + 1
  }
  if (masked.slice(start).trim()) {
    fail("transactional_preflight_sql_statement_unterminated")
  }
  return statements
}

function transactionStatements(statements) {
  return statements.filter(({ normalized }) => TRANSACTION_CONTROL_PATTERN.test(normalized))
}

function stripMigrationTransaction(source) {
  const sql = String(source)
  const statements = sqlStatements(sql)
  const controls = transactionStatements(statements)
  const first = statements[0]
  const last = statements.at(-1)
  const hasOuterTransaction = first?.normalized === "begin" && last?.normalized === "commit"

  if (hasOuterTransaction) {
    if (controls.length !== 2 || controls[0] !== first || controls[1] !== last) {
      fail("transactional_preflight_migration_escape_forbidden")
    }
    return sql.slice(first.end, last.start).trim()
  }
  if (controls.length > 0) fail("transactional_preflight_migration_escape_forbidden")
  return sql.trim()
}

function validateFocusedTest(source) {
  const statements = sqlStatements(source)
  const controls = transactionStatements(statements)
  const lines = String(source).split(/\r?\n/)
  while (lines.length > 0 && lines[0].trim() === "") lines.shift()
  while (lines.length > 0 && lines.at(-1).trim() === "") lines.pop()

  if (
    statements[0]?.normalized !== "begin" ||
    statements.at(-1)?.normalized !== "rollback" ||
    controls.length !== 2 ||
    controls[0] !== statements[0] ||
    controls[1] !== statements.at(-1)
  ) {
    fail("transactional_preflight_test_rollback_required")
  }

  const roleIndex = lines.findIndex((line) => /^\s*set\s+local\s+role\s+postgres\s*;\s*$/i.test(line))
  if (roleIndex < 1) {
    fail("transactional_preflight_test_role_anchor_missing")
  }
  return { lines, roleIndex }
}

export async function buildTransactionalPreflightSql({
  repoRoot,
  migrationLedger,
  forwardMigrationsPath,
  focusedTestPath,
}) {
  const { pendingVersions: ledgerPendingVersions, remoteMaxVersion } =
    migrationLedgerState(migrationLedger)
  const migrationDirectory = resolveInsideRepo(repoRoot, forwardMigrationsPath)
  const focusedTestFile = resolveInsideRepo(repoRoot, focusedTestPath)

  const migrationFiles = (await readdir(migrationDirectory))
    .map((file) => ({ file, version: file.match(MIGRATION_VERSION_PATTERN)?.[1] }))
    .filter(({ version }) => version && version > remoteMaxVersion)
    .sort((left, right) => left.version.localeCompare(right.version) || left.file.localeCompare(right.file))
  const migrationFileVersions = migrationFiles.map(({ version }) => version)
  if (
    new Set(migrationFileVersions).size !== migrationFileVersions.length ||
    JSON.stringify(migrationFileVersions) !== JSON.stringify(ledgerPendingVersions)
  ) {
    fail("transactional_preflight_pending_ledger_mismatch")
  }
  const pendingFiles = migrationFiles

  const migrationSections = []
  for (const { file, version } of pendingFiles) {
    const source = await readFile(resolveInsideRepo(repoRoot, `${forwardMigrationsPath}/${file}`), "utf8")
    const body = stripMigrationTransaction(source)
    migrationSections.push(
      [`-- transactional preflight migration ${version}: ${file}`, body, `-- end migration ${version}`]
        .filter(Boolean)
        .join("\n"),
    )
  }

  const focusedSource = await readFile(focusedTestFile, "utf8")
  const { lines, roleIndex } = validateFocusedTest(focusedSource)
  const insertion = migrationSections.length > 0 ? ["", ...migrationSections, ""] : []
  lines.splice(roleIndex + 1, 0, ...insertion)

  return {
    sql: `${lines.join("\n")}\n`,
    pendingVersions: pendingFiles.map(({ version }) => version),
    pendingFiles: pendingFiles.map(({ file }) => file),
    remoteMaxVersion,
  }
}

function parseCliArguments(argv) {
  const values = new Map()
  let rollback = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--rollback") {
      rollback = true
      continue
    }
    if (!argument.startsWith("--") || index + 1 >= argv.length) {
      fail("transactional_preflight_cli_arguments_invalid")
    }
    values.set(argument, argv[index + 1])
    index += 1
  }
  if (!rollback) fail("transactional_preflight_rollback_flag_required")

  const required = ["--output", "--migration-ledger", "--forward-migrations", "--focused-test"]
  if (required.some((name) => !values.get(name))) {
    fail("transactional_preflight_cli_arguments_invalid")
  }
  return values
}

async function main() {
  const args = parseCliArguments(process.argv.slice(2))
  const repoRoot = process.cwd()
  const migrationLedger = await readFile(args.get("--migration-ledger"), "utf8")
  const result = await buildTransactionalPreflightSql({
    repoRoot,
    migrationLedger,
    forwardMigrationsPath: args.get("--forward-migrations"),
    focusedTestPath: args.get("--focused-test"),
  })
  await writeFile(args.get("--output"), result.sql, "utf8")
  process.stdout.write(
    `Supabase transactional preflight: remote=${result.remoteMaxVersion}, pending=${
      result.pendingVersions.join(",") || "none"
    }\n`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
