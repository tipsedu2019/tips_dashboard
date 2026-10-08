import { readdir, readFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const defaultRepoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

// Existing migrations are immutable production history. Enforce the contract
// only after the last migration that was already on main when this guard was
// introduced.
export const LAST_GRANDFATHERED_MIGRATION = "20260820150057"

// These two races require a new transaction with a fresh lock set. They are
// not business-state conflicts: the worker observed identity/parent keys before
// locking, and the locked rescan differs. Keep the allowance tied to the exact
// migration, function declaration, and guarded RAISE context, once per guard.
export const WITHDRAWAL_CONCURRENCY_MIGRATION =
  "supabase/migrations/20261006090000_withdrawal_last_lesson_release.sql"

const withdrawalConcurrencyContexts = [
  {
    before: `select * into v_student from public.students where id=v_release.student_id for update;
      if not found then
        v_superseded:=true;
      elsif pg_catalog.lower(pg_catalog.regexp_replace(coalesce(v_student.name,''),'\\s+','','g')) is distinct from v_name_key
        or pg_catalog.regexp_replace(coalesce(v_student.parent_contact,''),'\\D+','','g') is distinct from v_parent_phone_key then`,
    after: `raise exception 'registration_workflow_retry_required' using errcode='40001'; end if;`,
  },
  {
    before: `select coalesce(pg_catalog.array_agg(distinct track.task_id order by track.task_id),array[]::uuid[])
      into v_current_parent_ids from public.ops_registration_enrollments enrollment
      join public.ops_registration_subject_tracks track on track.id=enrollment.track_id
      where enrollment.student_id=v_release.student_id and enrollment.class_id=v_release.class_id and enrollment.roster_active;
      if v_current_parent_ids is distinct from v_pre_parent_ids then`,
    after: `raise exception 'registration_workflow_retry_required' using errcode='40001'; end if;`,
  },
]

// Normalize formatting and keyword case, while preserving quoted SQL content.
function normalizedSql(source) {
  return [...source.matchAll(/'(?:''|[^'])*'|"(?:""|[^"])*"|[a-z_][a-z_0-9]*|\d+|::|:=|<>|>=|<=|\S/giu)]
    .map(([token]) => /^["']/u.test(token) ? token : token.toLowerCase())
    .join(" ")
}

function withdrawalWorkerSpans(source) {
  const spans = []
  let statementStart = 0
  let quote = null
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (character === quote) {
        if (source[index + 1] === quote) index += 1
        else quote = null
      }
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (character === "$") {
      const delimiter = /^\$(?:[a-z_][a-z_0-9]*)?\$/iu.exec(source.slice(index))?.[0]
      if (!delimiter) continue
      const bodyStart = index + delimiter.length
      const bodyEnd = source.indexOf(delimiter, bodyStart)
      if (bodyEnd === -1) return []
      const declaration = normalizedSql(source.slice(statementStart, index))
      if (declaration === normalizedSql(`create function dashboard_private.apply_scheduled_withdrawal_roster_release_v1(p_task_id uuid)
        returns text language plpgsql security definer set search_path='' set lock_timeout='5s' as`)) {
        spans.push({ start: bodyStart, end: bodyEnd })
      }
      // Only top-level SQL declarations count; never match an embedded function
      // declaration inside another function or a dynamic dollar-quoted string.
      index = bodyEnd + delimiter.length - 1
      continue
    }
    if (character === ";") statementStart = index + 1
  }
  return spans
}

function isUnquotedSqlOffset(source, start, offset) {
  let quote = null
  for (let index = start; index <= offset; index += 1) {
    if (index === offset) return quote === null
    const character = source[index]
    if (quote) {
      if (character === quote) {
        if (source[index + 1] === quote) index += 1
        else quote = null
      }
    } else if (character === "'" || character === '"') {
      quote = character
    } else if (character === "$") {
      const delimiter = /^\$(?:[a-z_][a-z_0-9]*)?\$/iu.exec(source.slice(index))?.[0]
      if (!delimiter) continue
      const end = source.indexOf(delimiter, index + delimiter.length)
      if (end === -1 || offset < end + delimiter.length) return false
      index = end + delimiter.length - 1
    }
  }
  return false
}

function allowedWithdrawalConcurrencyRaise({ file, source, offset, spans, usedContexts }) {
  if (file !== WITHDRAWAL_CONCURRENCY_MIGRATION || spans.length !== 1) return false
  const [span] = spans
  if (offset < span.start || offset >= span.end) return false
  if (!isUnquotedSqlOffset(source, span.start, offset)) return false
  const before = normalizedSql(source.slice(span.start, offset))
  const after = normalizedSql(source.slice(offset, span.end))
  const contextIndex = withdrawalConcurrencyContexts.findIndex((context, index) => (
    !usedContexts.has(index)
    && before.endsWith(normalizedSql(context.before))
    && after.startsWith(normalizedSql(context.after))
  ))
  if (contextIndex === -1) return false
  usedContexts.add(contextIndex)
  return true
}

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
  const concurrencySpans = file === WITHDRAWAL_CONCURRENCY_MIGRATION
    ? withdrawalWorkerSpans(sanitized)
    : []
  const usedConcurrencyContexts = new Set()
  let statementStart = 0

  for (let index = 0; index <= sanitized.length; index += 1) {
    if (index < sanitized.length && sanitized[index] !== ";") continue
    const statement = sanitized.slice(statementStart, index)
    if (
      /\braise\s+sqlstate\s+'40001'/i.test(statement)
      || (
        /\braise\s+exception\b/i.test(statement)
        && /\berrcode\s*=\s*'40001'/i.test(statement)
      )
    ) {
      const raiseOffset = statement.search(/\braise\s+(?:exception|sqlstate)\b/i)
      const absoluteOffset = statementStart + Math.max(raiseOffset, 0)
      if (allowedWithdrawalConcurrencyRaise({
        file,
        source: sanitized,
        offset: absoluteOffset,
        spans: concurrencySpans,
        usedContexts: usedConcurrencyContexts,
      })) {
        statementStart = index + 1
        continue
      }
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
