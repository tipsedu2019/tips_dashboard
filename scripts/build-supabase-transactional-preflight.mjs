import { createHash } from "node:crypto"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const MIGRATION_VERSION_PATTERN = /^(\d{14})_.+\.sql$/
const LEDGER_VERSION_PATTERN = /^\d{14}$/
const TRANSACTION_CONTROL_PATTERN = /^(?:begin\b|start\s+transaction\b|commit\b|end\b|rollback\b|abort\b|prepare\s+transaction\b(?!.*\bas\b))/i
const APPROVED_INTERLEAVED_PENDING_MIGRATIONS = Object.freeze([
  ["20260831013310_management_numbered_pages.sql", "577a477ad1ef68ad44768a39adc2cd7acda0a782dd12d02d9038397d24a65667"],
  ["20260831031913_ops_task_numbered_pages.sql", "2f3303d4dda16d925e70ed11ee5ae6b676aa90f92493cc54e4b5263e3199362c"],
  ["20260831052546_academic_operations_numbered_pages.sql", "32b51bd8ac1fc14d32bf01a260d1fa22a9324b658960de265f5b89bc0c61b0df"],
  ["20260831061736_approval_numbered_pages.sql", "f371ec311759886788112090fc0aeaeb9242ffb7f86d98348216eb553cbc799d"],
  ["20260831063537_approval_detail_trim_parity.sql", "6fb6efd7e5ba2441aa1ce91d23f2903d975c79567e42bea9d061aa5d6bf74c9b"],
  ["20260831065351_makeup_numbered_pages.sql", "9c5bd203b41adee3cdceb4723c6a1f440b4abd67a6adfea0bfb06e3d5f0465bf"],
  ["20260831101449_makeup_system_note_whitespace_parity.sql", "940613f164be35b25661750e8be5c0f15409409890308a5e046ef0fed31369ff"],
  ["20260831103631_makeup_source_precision_parity.sql", "47413b333331c9abfe4e771f52e9078b4edc8d88e8cf2b0125dc437a246328ba"],
  ["20260831123610_textbook_inventory_numbered_reads.sql", "f4ba6fc76223af13704a1187ff45db5f187b1633392b2516714c9a1e2522dcb5"],
])

function fail(code) {
  throw new Error(code)
}

function sha256(source) {
  return createHash("sha256").update(source).digest("hex")
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

function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function jsonMigrationLedgerRows(source) {
  let receipt
  try {
    receipt = JSON.parse(source)
  } catch {
    fail("transactional_preflight_ledger_malformed")
  }

  if (
    !isPlainRecord(receipt) ||
    JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(["message", "migrations"]) ||
    receipt.message !== "Migrations listed" ||
    !Array.isArray(receipt.migrations)
  ) {
    fail("transactional_preflight_ledger_malformed")
  }

  return receipt.migrations.map((row) => {
    if (
      !isPlainRecord(row) ||
      JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(["local", "remote", "time"]) ||
      typeof row.local !== "string" ||
      typeof row.remote !== "string" ||
      typeof row.time !== "string" ||
      row.time.length === 0 ||
      (row.local && !LEDGER_VERSION_PATTERN.test(row.local)) ||
      (row.remote && !LEDGER_VERSION_PATTERN.test(row.remote)) ||
      (!row.local && !row.remote)
    ) {
      fail("transactional_preflight_ledger_malformed")
    }
    return { local: row.local || null, remote: row.remote || null }
  })
}

function migrationLedgerState(ledger) {
  const source = String(ledger).trim()
  const rows = source.startsWith("{")
    ? jsonMigrationLedgerRows(source)
    : source
      .split(/\r?\n/)
      .map((line) => line.split("|").slice(0, 2).map((value) => value?.trim() ?? ""))
      .map(([local, remote]) => ({
        local: LEDGER_VERSION_PATTERN.test(local) ? local : null,
        remote: LEDGER_VERSION_PATTERN.test(remote) ? remote : null,
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

  const remoteVersionSet = new Set(remoteVersions)
  const remoteMaxVersion = remoteVersions.at(-1)
  const pendingVersions = rows
    .filter(({ local, remote }) => local && !remote)
    .map(({ local }) => local)
    .sort()
  if (new Set(pendingVersions).size !== pendingVersions.length) {
    fail("transactional_preflight_pending_ledger_mismatch")
  }
  return { pendingVersions, remoteMaxVersion, remoteVersionSet }
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
  if (masked.includes("\\")) {
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
  const { pendingVersions: ledgerPendingVersions, remoteMaxVersion, remoteVersionSet } =
    migrationLedgerState(migrationLedger)
  const migrationDirectory = resolveInsideRepo(repoRoot, forwardMigrationsPath)
  const focusedTestFile = resolveInsideRepo(repoRoot, focusedTestPath)

  const approvedInterleavedByVersion = new Map(
    APPROVED_INTERLEAVED_PENDING_MIGRATIONS.map(([file, expectedHash]) => [
      file.slice(0, 14),
      { file, expectedHash },
    ]),
  )
  if (ledgerPendingVersions.some(
    (version) => version <= remoteMaxVersion && !approvedInterleavedByVersion.has(version),
  )) {
    fail("transactional_preflight_unapplied_legacy_migration")
  }
  const migrationFiles = (await readdir(migrationDirectory))
    .map((file) => ({ file, version: file.match(MIGRATION_VERSION_PATTERN)?.[1] }))
    .filter(({ version }) => version && !remoteVersionSet.has(version) && (
      version > remoteMaxVersion || approvedInterleavedByVersion.has(version)
    ))
    .sort((left, right) => left.version.localeCompare(right.version) || left.file.localeCompare(right.file))
  const migrationFileVersions = migrationFiles.map(({ version }) => version)
  if (
    new Set(migrationFileVersions).size !== migrationFileVersions.length ||
    JSON.stringify(migrationFileVersions) !== JSON.stringify(ledgerPendingVersions)
  ) {
    fail("transactional_preflight_pending_ledger_mismatch")
  }
  const pendingFiles = migrationFiles
  const interleavedPendingVersions = pendingFiles
    .filter(({ version }) => version <= remoteMaxVersion)
    .map(({ version }) => version)

  for (const { file, version } of pendingFiles) {
    if (version > remoteMaxVersion) continue
    const approved = approvedInterleavedByVersion.get(version)
    if (!approved || approved.file !== file) {
      fail("transactional_preflight_unapplied_legacy_migration")
    }
    const source = await readFile(resolveInsideRepo(repoRoot, `${forwardMigrationsPath}/${file}`))
    if (sha256(source) !== approved.expectedHash) {
      fail("transactional_preflight_interleaved_hash_mismatch")
    }
  }

  const migrationSections = []
  for (const { file, version } of pendingFiles) {
    const source = await readFile(resolveInsideRepo(repoRoot, `${forwardMigrationsPath}/${file}`), "utf8")
    const body = stripMigrationTransaction(source)
    migrationSections.push(
      [
        `-- transactional preflight migration ${version}: ${file}`,
        body,
        "-- enforce the deferred-constraint checks that a real migration commit would run",
        "set constraints all immediate;",
        "-- restore the initially-deferred mode expected by the next transaction",
        "set constraints all deferred;",
        `-- end migration ${version}`,
      ]
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
    interleavedPendingVersions,
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
