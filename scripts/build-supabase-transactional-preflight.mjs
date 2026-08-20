import { readdir, readFile, writeFile } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const MIGRATION_VERSION_PATTERN = /^(\d{14})_.+\.sql$/
const TRANSACTION_CONTROL_PATTERN = /^\s*(?:begin|commit|rollback)\s*;\s*$/i

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

function remoteMaxVersionFromLedger(ledger) {
  const versions = String(ledger)
    .split(/\r?\n/)
    .map((line) => line.split("|")[1]?.trim() ?? "")
    .filter((value) => /^\d{14}$/.test(value))
    .sort()

  if (versions.length === 0) {
    fail("transactional_preflight_remote_ledger_missing")
  }
  return versions.at(-1)
}

function stripMigrationTransaction(source) {
  const lines = String(source).split(/\r?\n/)
  while (lines.length > 0 && lines[0].trim() === "") lines.shift()
  while (lines.length > 0 && lines.at(-1).trim() === "") lines.pop()

  const hasOuterTransaction =
    /^\s*begin\s*;\s*$/i.test(lines[0] ?? "") &&
    /^\s*commit\s*;\s*$/i.test(lines.at(-1) ?? "")

  const body = hasOuterTransaction ? lines.slice(1, -1) : lines
  if (body.some((line) => TRANSACTION_CONTROL_PATTERN.test(line))) {
    fail("transactional_preflight_migration_escape_forbidden")
  }
  if (!hasOuterTransaction && lines.some((line) => TRANSACTION_CONTROL_PATTERN.test(line))) {
    fail("transactional_preflight_migration_escape_forbidden")
  }
  return body.join("\n").trim()
}

function validateFocusedTest(source) {
  const lines = String(source).split(/\r?\n/)
  while (lines.length > 0 && lines[0].trim() === "") lines.shift()
  while (lines.length > 0 && lines.at(-1).trim() === "") lines.pop()

  const transactionLines = lines
    .map((line, index) => ({ index, value: line.trim().toLowerCase() }))
    .filter(({ value }) => /^(?:begin|commit|rollback)\s*;$/.test(value))

  if (
    !/^begin\s*;$/i.test(lines[0] ?? "") ||
    !/^rollback\s*;$/i.test(lines.at(-1) ?? "") ||
    transactionLines.length !== 2 ||
    transactionLines[0]?.index !== 0 ||
    transactionLines[1]?.index !== lines.length - 1
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
  const remoteMaxVersion = remoteMaxVersionFromLedger(migrationLedger)
  const migrationDirectory = resolveInsideRepo(repoRoot, forwardMigrationsPath)
  const focusedTestFile = resolveInsideRepo(repoRoot, focusedTestPath)

  const pendingFiles = (await readdir(migrationDirectory))
    .map((file) => ({ file, version: file.match(MIGRATION_VERSION_PATTERN)?.[1] }))
    .filter(({ version }) => version && version > remoteMaxVersion)
    .sort((left, right) => left.version.localeCompare(right.version) || left.file.localeCompare(right.file))

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
