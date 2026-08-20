import { readdir, readFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const defaultRepoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

// Existing migrations are immutable production history. Enforce the contract
// only after the last migration that was already on main when this guard was
// introduced.
export const LAST_GRANDFATHERED_MIGRATION = "20260820150057"

function migrationVersion(file) {
  return /^(\d{14})_[a-z0-9_]+\.sql$/i.exec(basename(file))?.[1] ?? null
}

function withoutSqlComments(source) {
  let result = ""
  let quote = null
  let blockComment = false
  let lineComment = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]

    if (lineComment) {
      if (character === "\n") {
        lineComment = false
        result += "\n"
      } else {
        result += " "
      }
      continue
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        result += "  "
        index += 1
        blockComment = false
      } else {
        result += character === "\n" ? "\n" : " "
      }
      continue
    }
    if (quote) {
      result += character
      if (character === quote) {
        if (next === quote) {
          result += next
          index += 1
        } else {
          quote = null
        }
      }
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      result += character
      continue
    }
    if (character === "-" && next === "-") {
      result += "  "
      index += 1
      lineComment = true
      continue
    }
    if (character === "/" && next === "*") {
      result += "  "
      index += 1
      blockComment = true
      continue
    }
    result += character
  }

  return result
}

export function inspectDomainSqlstateMigration({
  file,
  source,
  cutoff = LAST_GRANDFATHERED_MIGRATION,
}) {
  const version = migrationVersion(file)
  if (version === null || version <= cutoff) return []

  const sanitized = withoutSqlComments(source)
  const violations = []
  let statementStart = 0

  for (let index = 0; index <= sanitized.length; index += 1) {
    if (index < sanitized.length && sanitized[index] !== ";") continue
    const statement = sanitized.slice(statementStart, index)
    if (
      /\braise\s+(?:exception|sqlstate)\b/i.test(statement)
      && /\berrcode\s*=\s*'40001'/i.test(statement)
    ) {
      const raiseOffset = statement.search(/\braise\s+(?:exception|sqlstate)\b/i)
      const absoluteOffset = statementStart + Math.max(raiseOffset, 0)
      const line = sanitized.slice(0, absoluteOffset).split("\n").length
      violations.push({
        file,
        line,
        reason: "domain_sqlstate_40001_forbidden",
      })
    }
    statementStart = index + 1
  }

  return violations
}

export async function verifyDomainSqlstateContract({ repoRoot = defaultRepoRoot } = {}) {
  const migrationsDir = join(repoRoot, "supabase", "migrations")
  const files = (await readdir(migrationsDir))
    .filter((file) => migrationVersion(file) !== null)
    .sort()
  const violations = []

  for (const file of files) {
    const path = join(migrationsDir, file)
    violations.push(...inspectDomainSqlstateMigration({
      file: join("supabase", "migrations", file),
      source: await readFile(path, "utf8"),
    }))
  }

  return violations
}

async function main() {
  const violations = await verifyDomainSqlstateContract()
  if (violations.length === 0) {
    process.stdout.write("domain SQLSTATE contract verified\n")
    return
  }
  for (const violation of violations) {
    process.stderr.write(
      `${violation.file}:${violation.line} ${violation.reason}: use a non-retryable domain SQLSTATE\n`,
    )
  }
  process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
