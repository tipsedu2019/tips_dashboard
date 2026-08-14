#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { verifyQuerySurfaceBudget } from "../src/lib/query-surface-budget.js"

export const APPROVED_EXCEPTION_REASONS = Object.freeze(["schema probing", "exact-ID detail", "test fixture"])
export const OPERATIONAL_LEGACY_EXCEPTIONS = Object.freeze([])

const CI_REVISION = /^[0-9a-f]{40}$/u
const CHECKSUM = /^[0-9a-f]{64}$/u
const MIGRATION_PATH = /^supabase\/migrations\/[^/]+\.sql$/u
const PII_RECEIPT_COLUMNS = Object.freeze([
  ["full_phone_receipt_column", /\b(?:full_phone|phone_number|phone_digits|normalized_phone|recipient_phone(?:_digits)?|parent_phone(?:_digits)?)\b/iu],
  ["full_message_receipt_column", /\b(?:full_message|message_body|message_content|message_text|raw_message|rendered_message)\b/iu],
  ["webhook_receipt_column", /\b(?:webhook_url|webhook_address|webhook_body|webhook_payload|webhook_response)\b/iu],
  ["provider_raw_receipt_column", /\b(?:provider_raw_receipt|raw_provider_receipt|raw_receipt|receipt_raw|provider_(?:request|response|payload|receipt)(?:_(?:body|json|raw))?)\b/iu],
])
const GENERIC_OPERATIONAL_RECEIPT_COLUMNS = Object.freeze([
  ["full_phone_receipt_column", /\bphone\b/iu],
  ["full_message_receipt_column", /\bmessage\b/iu],
  ["webhook_receipt_column", /\b(?:webhook|hook_url)\b/iu],
  ["provider_raw_receipt_column", /\b(?:raw_payload|receipt_payload)\b/iu],
])

function freeTierError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function git(root, args, code = "free_tier_git_failed") {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
  } catch {
    throw freeTierError(code)
  }
}

function resolveCommit(root, revision) {
  if (typeof revision !== "string" || revision.length === 0) throw freeTierError("free_tier_git_object_invalid")
  const resolved = git(root, ["rev-parse", "--verify", `${revision}^{commit}`], "free_tier_git_object_invalid")
  if (!CI_REVISION.test(resolved)) throw freeTierError("free_tier_git_object_invalid")
  return resolved
}

function mergeBase(root, baseSha, headSha) {
  const resolved = git(root, ["merge-base", baseSha, headSha], "free_tier_merge_base_unavailable")
  if (!CI_REVISION.test(resolved)) throw freeTierError("free_tier_merge_base_unavailable")
  return resolved
}

function dollarTagAt(source, index) {
  return source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u)?.[0] ?? null
}

function splitSqlStatements(source) {
  const statements = []
  let start = 0
  let index = 0
  let mode = "code"
  let dollarTag = null
  let blockDepth = 0
  while (index < source.length) {
    const current = source[index]
    const next = source[index + 1]
    if (mode === "line-comment") {
      if (current === "\n") mode = "code"
      index += 1
      continue
    }
    if (mode === "block-comment") {
      if (current === "/" && next === "*") {
        blockDepth += 1
        index += 2
      } else if (current === "*" && next === "/") {
        blockDepth -= 1
        index += 2
        if (blockDepth === 0) mode = "code"
      } else index += 1
      continue
    }
    if (mode === "single") {
      if (current === "'" && next === "'") index += 2
      else {
        if (current === "'") mode = "code"
        index += 1
      }
      continue
    }
    if (mode === "double") {
      if (current === "\"" && next === "\"") index += 2
      else {
        if (current === "\"") mode = "code"
        index += 1
      }
      continue
    }
    if (mode === "dollar") {
      if (source.startsWith(dollarTag, index)) {
        index += dollarTag.length
        mode = "code"
        dollarTag = null
      } else index += 1
      continue
    }
    if (current === "-" && next === "-") {
      mode = "line-comment"
      index += 2
      continue
    }
    if (current === "/" && next === "*") {
      mode = "block-comment"
      blockDepth = 1
      index += 2
      continue
    }
    if (current === "'") {
      mode = "single"
      index += 1
      continue
    }
    if (current === "\"") {
      mode = "double"
      index += 1
      continue
    }
    if (current === "$") {
      const tag = dollarTagAt(source, index)
      if (tag) {
        mode = "dollar"
        dollarTag = tag
        index += tag.length
        continue
      }
    }
    if (current === ";") {
      const text = source.slice(start, index + 1)
      if (text.trim()) statements.push(text)
      start = index + 1
    }
    index += 1
  }
  const tail = source.slice(start)
  if (tail.trim()) statements.push(tail)
  return statements
}

function maskCommentsAndDollarBodies(source, { maskDollarBodies = true, maskSingleQuotedBodies = false } = {}) {
  let result = ""
  let index = 0
  let mode = "code"
  let blockDepth = 0
  while (index < source.length) {
    const current = source[index]
    const next = source[index + 1]
    if (mode === "line-comment") {
      if (current === "\n") {
        result += "\n"
        mode = "code"
      } else result += " "
      index += 1
      continue
    }
    if (mode === "block-comment") {
      if (current === "/" && next === "*") {
        result += "  "
        blockDepth += 1
        index += 2
      } else if (current === "*" && next === "/") {
        result += "  "
        blockDepth -= 1
        index += 2
        if (blockDepth === 0) mode = "code"
      } else {
        result += current === "\n" ? "\n" : " "
        index += 1
      }
      continue
    }
    if (mode === "single") {
      result += maskSingleQuotedBodies ? (current === "\n" ? "\n" : " ") : current
      if (current === "'" && next === "'") {
        result += maskSingleQuotedBodies ? " " : next
        index += 2
      } else {
        if (current === "'") mode = "code"
        index += 1
      }
      continue
    }
    if (mode === "double") {
      result += current
      if (current === "\"" && next === "\"") {
        result += next
        index += 2
      } else {
        if (current === "\"") mode = "code"
        index += 1
      }
      continue
    }
    if (current === "-" && next === "-") {
      result += "  "
      mode = "line-comment"
      index += 2
      continue
    }
    if (current === "/" && next === "*") {
      result += "  "
      mode = "block-comment"
      blockDepth = 1
      index += 2
      continue
    }
    if (current === "'") {
      result += maskSingleQuotedBodies ? " " : current
      mode = "single"
      index += 1
      continue
    }
    if (current === "\"") {
      result += current
      mode = "double"
      index += 1
      continue
    }
    if (current === "$") {
      const tag = dollarTagAt(source, index)
      if (tag) {
        const bodyStart = index + tag.length
        const closing = source.indexOf(tag, bodyStart)
        if (closing >= 0) {
          const body = source.slice(bodyStart, closing)
          if (maskDollarBodies) {
            const block = source.slice(index, closing + tag.length)
            result += block.replace(/[^\n]/gu, " ")
          } else {
            result += tag
            result += maskCommentsAndDollarBodies(body, { maskDollarBodies: false, maskSingleQuotedBodies })
            result += tag
          }
          index = closing + tag.length
          continue
        }
      }
    }
    result += current
    index += 1
  }
  return result
}

function occurrenceChecksum({ file, symbol, reason, statement }) {
  return createHash("sha256")
    .update(JSON.stringify([file, symbol, reason, statement.trim()]))
    .digest("hex")
}

function tableIdentifier(statement, expression) {
  return statement.match(expression)?.[1]?.replaceAll('"', "") ?? null
}

function firstDollarBody(source) {
  let index = 0
  let mode = "code"
  let blockDepth = 0
  while (index < source.length) {
    const current = source[index]
    const next = source[index + 1]
    if (mode === "line-comment") {
      if (current === "\n") mode = "code"
      index += 1
      continue
    }
    if (mode === "block-comment") {
      if (current === "/" && next === "*") {
        blockDepth += 1
        index += 2
      } else if (current === "*" && next === "/") {
        blockDepth -= 1
        index += 2
        if (blockDepth === 0) mode = "code"
      } else index += 1
      continue
    }
    if (mode === "single") {
      if (current === "'" && next === "'") index += 2
      else {
        if (current === "'") mode = "code"
        index += 1
      }
      continue
    }
    if (current === "-" && next === "-") {
      mode = "line-comment"
      index += 2
      continue
    }
    if (current === "/" && next === "*") {
      mode = "block-comment"
      blockDepth = 1
      index += 2
      continue
    }
    if (current === "'") {
      mode = "single"
      index += 1
      continue
    }
    if (current === "$") {
      const tag = dollarTagAt(source, index)
      if (tag) {
        const bodyStart = index + tag.length
        const closing = source.indexOf(tag, bodyStart)
        if (closing < 0) return null
        return source.slice(bodyStart, closing)
      }
    }
    index += 1
  }
  return null
}

function readParenthesized(source, openingIndex) {
  let depth = 1
  let index = openingIndex + 1
  let mode = "code"
  let dollarTag = null
  let blockDepth = 0
  while (index < source.length) {
    const current = source[index]
    const next = source[index + 1]
    if (mode === "line-comment") {
      if (current === "\n") mode = "code"
      index += 1
      continue
    }
    if (mode === "block-comment") {
      if (current === "/" && next === "*") {
        blockDepth += 1
        index += 2
      } else if (current === "*" && next === "/") {
        blockDepth -= 1
        index += 2
        if (blockDepth === 0) mode = "code"
      } else index += 1
      continue
    }
    if (mode === "single") {
      if (current === "'" && next === "'") index += 2
      else {
        if (current === "'") mode = "code"
        index += 1
      }
      continue
    }
    if (mode === "double") {
      if (current === '"' && next === '"') index += 2
      else {
        if (current === '"') mode = "code"
        index += 1
      }
      continue
    }
    if (mode === "dollar") {
      if (source.startsWith(dollarTag, index)) {
        index += dollarTag.length
        mode = "code"
        dollarTag = null
      } else index += 1
      continue
    }
    if (current === "-" && next === "-") {
      mode = "line-comment"
      index += 2
      continue
    }
    if (current === "/" && next === "*") {
      mode = "block-comment"
      blockDepth = 1
      index += 2
      continue
    }
    if (current === "'") {
      mode = "single"
      index += 1
      continue
    }
    if (current === '"') {
      mode = "double"
      index += 1
      continue
    }
    if (current === "$") {
      const tag = dollarTagAt(source, index)
      if (tag) {
        dollarTag = tag
        mode = "dollar"
        index += tag.length
        continue
      }
    }
    if (current === "(") depth += 1
    if (current === ")") {
      depth -= 1
      if (depth === 0) return { contents: source.slice(openingIndex + 1, index), closingIndex: index }
    }
    index += 1
  }
  return null
}

function splitSqlArguments(source) {
  const argumentsList = []
  let start = 0
  let depth = 0
  let index = 0
  let mode = "code"
  let dollarTag = null
  let blockDepth = 0
  while (index < source.length) {
    const current = source[index]
    const next = source[index + 1]
    if (mode === "line-comment") {
      if (current === "\n") mode = "code"
      index += 1
      continue
    }
    if (mode === "block-comment") {
      if (current === "/" && next === "*") {
        blockDepth += 1
        index += 2
      } else if (current === "*" && next === "/") {
        blockDepth -= 1
        index += 2
        if (blockDepth === 0) mode = "code"
      } else index += 1
      continue
    }
    if (mode === "single") {
      if (current === "'" && next === "'") index += 2
      else {
        if (current === "'") mode = "code"
        index += 1
      }
      continue
    }
    if (mode === "double") {
      if (current === '"' && next === '"') index += 2
      else {
        if (current === '"') mode = "code"
        index += 1
      }
      continue
    }
    if (mode === "dollar") {
      if (source.startsWith(dollarTag, index)) {
        index += dollarTag.length
        mode = "code"
        dollarTag = null
      } else index += 1
      continue
    }
    if (current === "-" && next === "-") {
      mode = "line-comment"
      index += 2
      continue
    }
    if (current === "/" && next === "*") {
      mode = "block-comment"
      blockDepth = 1
      index += 2
      continue
    }
    if (current === "'") mode = "single"
    else if (current === '"') mode = "double"
    else if (current === "$") {
      const tag = dollarTagAt(source, index)
      if (tag) {
        dollarTag = tag
        mode = "dollar"
        index += tag.length
        continue
      }
    } else if (current === "(") depth += 1
    else if (current === ")") depth -= 1
    else if (current === "," && depth === 0) {
      argumentsList.push(source.slice(start, index).trim())
      start = index + 1
    }
    index += 1
  }
  argumentsList.push(source.slice(start).trim())
  return argumentsList
}

function sqlLiteralValue(argument) {
  const value = maskCommentsAndDollarBodies(argument, { maskDollarBodies: false }).trim()
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'")
  if (/^[eE]'/u.test(value) && value.endsWith("'")) return value.slice(2, -1).replaceAll("''", "'")
  const dollar = value.match(/^(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)([\s\S]*)\1$/u)
  return dollar ? dollar[2] : null
}

function scheduleCalls(region) {
  const code = maskCommentsAndDollarBodies(region, { maskSingleQuotedBodies: true })
  const calls = []
  for (const match of code.matchAll(/(?:\bcron\b|"cron")\s*\.\s*(?:\bschedule\b|"schedule")\s*\(/giu)) {
    const openingIndex = match.index + match[0].lastIndexOf("(")
    const parsed = readParenthesized(region, openingIndex)
    if (!parsed) continue
    const prefix = code.slice(0, match.index)
    const verb = prefix.match(/\b(select|perform|call)\s*$/iu)?.[1]?.toLowerCase() ?? null
    calls.push({ arguments: splitSqlArguments(parsed.contents), verb })
  }
  return calls
}

function declaredColumnNames(statement) {
  const code = maskCommentsAndDollarBodies(statement, { maskSingleQuotedBodies: true })
  const names = []
  const create = code.match(/\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?[^\s(]+\s*\(/iu)
  if (create) {
    const openingIndex = create.index + create[0].lastIndexOf("(")
    const body = readParenthesized(statement, openingIndex)
    for (const definition of body ? splitSqlArguments(body.contents) : []) {
      const identifier = maskCommentsAndDollarBodies(definition, { maskSingleQuotedBodies: true }).trim()
        .match(/^(?:"((?:""|[^"])*)"|([A-Za-z_][A-Za-z0-9_$]*))/u)
      const name = (identifier?.[1] ?? identifier?.[2] ?? "").replaceAll('""', '"')
      if (name && !/^(?:check|constraint|exclude|foreign|primary|unique)$/iu.test(name)) names.push(name)
    }
  }
  for (const match of code.matchAll(/\badd\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?(?:"((?:""|[^"])*)"|([A-Za-z_][A-Za-z0-9_$]*))/giu)) {
    names.push((match[1] ?? match[2]).replaceAll('""', '"'))
  }
  return names
}

export function inspectOperationalMigrationSource({ file, source }) {
  if (typeof file !== "string" || typeof source !== "string") throw freeTierError("free_tier_operational_source_invalid")
  const violations = []
  const record = (statement, statementIndex, reason) => {
    const symbol = `statement:${statementIndex + 1}`
    violations.push({
      file,
      symbol,
      reason,
      checksum: occurrenceChecksum({ file, symbol, reason, statement }),
    })
  }
  for (const [statementIndex, statement] of splitSqlStatements(source).entries()) {
    const executable = maskCommentsAndDollarBodies(statement)
    const executableWithBodies = maskCommentsAndDollarBodies(statement, { maskDollarBodies: false })
    const statementCalls = scheduleCalls(statement)
    const functionOrDo = /^\s*(?:do\b|create\s+(?:or\s+replace\s+)?(?:function|procedure)\b)/iu.test(
      maskCommentsAndDollarBodies(statement, { maskSingleQuotedBodies: true }),
    )
    const bodyCalls = functionOrDo ? scheduleCalls(firstDollarBody(statement) ?? "") : []
    const isDo = /^\s*do\b/iu.test(maskCommentsAndDollarBodies(statement, { maskSingleQuotedBodies: true }))
    const directSchedule = statementCalls.some(({ verb }) => verb === "select" || verb === "call")
      || (isDo && bodyCalls.length > 0)
    if (directSchedule) record(statement, statementIndex, "cron_schedule_direct_activation")
    if ([...statementCalls, ...bodyCalls].some((call) => {
      const values = call.arguments.map((argument) => sqlLiteralValue(argument) ?? argument)
      return values.some((value) => value.trim() === "* * * * *")
        && values.some((value) => /notification/iu.test(value))
    })) {
      record(statement, statementIndex, "notification_every_minute_cron")
    }

    const createdTable = tableIdentifier(executable, /\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?([^\s(]+)/iu)
    if (createdTable && /(?:heartbeat|watchdog)/iu.test(createdTable)) record(statement, statementIndex, "heartbeat_or_watchdog_table")
    const writtenTable = tableIdentifier(executableWithBodies, /\b(?:insert\s+into|update|delete\s+from|merge\s+into)\s+([^\s(;]+)/iu)
    if (writtenTable && /(?:heartbeat|watchdog)/iu.test(writtenTable)) record(statement, statementIndex, "heartbeat_or_watchdog_write")

    const createsOrAddsColumns = /\bcreate\s+(?:unlogged\s+)?table\b/iu.test(executable)
      || /\balter\s+table\b[\s\S]*\badd\s+(?:column\s+)?/iu.test(executable)
    if (createsOrAddsColumns) {
      const alteredTable = tableIdentifier(executable, /\balter\s+table\s+(?:if\s+exists\s+)?([^\s;]+)/iu)
      const operationalReceiptTable = /(?:audit|delivery|notification|provider|receipt|webhook)/iu.test(createdTable ?? alteredTable ?? "")
      const recordedReasons = new Set()
      const columns = declaredColumnNames(statement).join("\n")
      for (const [reason, expression] of PII_RECEIPT_COLUMNS) {
        if (expression.test(columns)) recordedReasons.add(reason)
      }
      if (operationalReceiptTable) {
        for (const [reason, expression] of GENERIC_OPERATIONAL_RECEIPT_COLUMNS) {
          if (expression.test(columns)) recordedReasons.add(reason)
        }
      }
      for (const reason of recordedReasons) record(statement, statementIndex, reason)
    }

    const cronDelete = /\b(?:delete\s+from|truncate(?:\s+table)?)\s+cron\s*\.\s*job\b/iu.test(executableWithBodies)
    const unscheduleCalls = [...executableWithBodies.matchAll(/\bcron\s*\.\s*unschedule\s*\(\s*([^)]*?)\s*\)/giu)]
    const broadUnschedule = unscheduleCalls.some((match) => !/^(?:'[A-Za-z0-9_.:-]+'|[1-9][0-9]*)$/u.test(match[1].trim()))
      || (unscheduleCalls.length > 0 && /\bfrom\s+cron\s*\.\s*job\b/iu.test(executableWithBodies))
    if (cronDelete || broadUnschedule) record(statement, statementIndex, "broad_cron_removal")
  }
  return violations
}

function changedFiles({ root, baseSha, headSha, includeWorktree }) {
  const args = includeWorktree
    ? ["diff", "--name-only", baseSha]
    : ["diff", "--name-only", `${baseSha}..${headSha}`]
  const changed = git(root, args).split("\n").filter(Boolean)
  if (!includeWorktree) return changed
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean)
  return [...new Set([...changed, ...untracked])]
}

async function sourceAt({ root, file, revision, includeWorktree }) {
  if (includeWorktree) {
    try {
      return await readFile(resolve(root, file), "utf8")
    } catch (error) {
      if (error?.code === "ENOENT") return null
      throw freeTierError("free_tier_source_read_failed")
    }
  }
  try {
    return git(root, ["show", `${revision}:${file}`], "free_tier_source_missing")
  } catch (error) {
    if (error.code === "free_tier_source_missing") return null
    throw error
  }
}

function exceptionKey({ file, symbol, violation, checksum }) {
  return `${file}\u0000${symbol}\u0000${violation}\u0000${checksum}`
}

async function validatedExceptionMap({ root, operationalExceptions }) {
  if (!Array.isArray(operationalExceptions)) throw freeTierError("free_tier_exception_manifest_invalid")
  const entries = new Map()
  for (const entry of operationalExceptions) {
    if (!entry || typeof entry.file !== "string" || !MIGRATION_PATH.test(entry.file)
      || typeof entry.symbol !== "string" || typeof entry.violation !== "string"
      || !APPROVED_EXCEPTION_REASONS.includes(entry.reason) || !CI_REVISION.test(entry.baselineSha)
      || !CHECKSUM.test(entry.checksum)) throw freeTierError("free_tier_exception_manifest_invalid")
    const baselineSource = await sourceAt({ root, file: entry.file, revision: entry.baselineSha, includeWorktree: false })
    if (baselineSource === null) throw freeTierError("free_tier_exception_manifest_invalid")
    const baselineViolation = inspectOperationalMigrationSource({ file: entry.file, source: baselineSource })
      .find((violation) => violation.symbol === entry.symbol && violation.reason === entry.violation
        && violation.checksum === entry.checksum)
    if (!baselineViolation) throw freeTierError("free_tier_exception_manifest_invalid")
    const key = exceptionKey(entry)
    if (entries.has(key)) throw freeTierError("free_tier_exception_manifest_invalid")
    entries.set(key, entry)
  }
  return entries
}

function publicOperationalViolation({ file, symbol, reason }) {
  return { file, symbol, reason }
}

function compareViolations(left, right) {
  return `${left.file}\u0000${left.symbol}\u0000${left.reason}`.localeCompare(`${right.file}\u0000${right.symbol}\u0000${right.reason}`)
}

export async function verifyFreeTierContracts({
  surface,
  baseSha,
  headSha,
  includeWorktree = false,
  root = process.cwd(),
  queryDebtManifest,
  operationalExceptions = OPERATIONAL_LEGACY_EXCEPTIONS,
}) {
  if (includeWorktree === Boolean(headSha)) throw freeTierError("free_tier_mode_invalid")
  if (!includeWorktree && (!CI_REVISION.test(baseSha ?? "") || !CI_REVISION.test(headSha ?? ""))) {
    throw freeTierError("free_tier_ci_revision_invalid")
  }
  const resolvedBase = resolveCommit(root, baseSha)
  const resolvedHead = includeWorktree ? undefined : resolveCommit(root, headSha)
  const comparisonBase = includeWorktree
    ? (baseSha === "HEAD" ? resolveCommit(root, `${resolvedBase}^`) : resolvedBase)
    : mergeBase(root, resolvedBase, resolvedHead)
  const queryOptions = {
    root,
    surface,
    baseSha: comparisonBase,
    ...(includeWorktree ? { includeWorktree: true } : { headSha: resolvedHead }),
    ...(queryDebtManifest === undefined ? {} : { debtManifest: queryDebtManifest }),
  }
  const queryResult = await verifyQuerySurfaceBudget(queryOptions)
  const exceptionMap = await validatedExceptionMap({ root, operationalExceptions })
  const files = changedFiles({ root, baseSha: comparisonBase, headSha: resolvedHead, includeWorktree })
  const violations = [...queryResult.violations]
  for (const file of files.filter((candidate) => MIGRATION_PATH.test(candidate))) {
    const source = await sourceAt({ root, file, revision: resolvedHead, includeWorktree })
    if (source === null) continue
    const baselineSource = await sourceAt({ root, file, revision: comparisonBase, includeWorktree: false })
    const baselineKeys = new Set((baselineSource === null ? [] : inspectOperationalMigrationSource({ file, source: baselineSource }))
      .map((violation) => exceptionKey({ ...violation, violation: violation.reason })))
    for (const violation of inspectOperationalMigrationSource({ file, source })) {
      const key = exceptionKey({ ...violation, violation: violation.reason })
      if (!(exceptionMap.has(key) && baselineKeys.has(key))) violations.push(publicOperationalViolation(violation))
    }
  }
  violations.sort(compareViolations)
  return { ok: violations.length === 0, violations }
}

function parseArgs(argv) {
  const values = new Map()
  let includeWorktree = false
  const valueOptions = new Set(["--base", "--head", "--surface"])
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === "--worktree") {
      if (includeWorktree) throw freeTierError("free_tier_argument_duplicate")
      includeWorktree = true
      continue
    }
    if (!valueOptions.has(token) || index + 1 >= argv.length) throw freeTierError("free_tier_arguments_invalid")
    if (values.has(token)) throw freeTierError("free_tier_argument_duplicate")
    values.set(token, argv[index + 1])
    index += 1
  }
  const surface = values.get("--surface")
  const baseSha = values.get("--base")
  const headSha = values.get("--head")
  if (!surface || !baseSha) throw freeTierError("free_tier_arguments_required")
  if (includeWorktree === Boolean(headSha)) throw freeTierError("free_tier_mode_invalid")
  if (!includeWorktree && (!CI_REVISION.test(baseSha) || !CI_REVISION.test(headSha))) {
    throw freeTierError("free_tier_ci_revision_invalid")
  }
  return { surface, baseSha, ...(headSha ? { headSha } : {}), includeWorktree }
}

async function main() {
  try {
    const result = await verifyFreeTierContracts(parseArgs(process.argv.slice(2)))
    if (!result.ok) {
      for (const violation of result.violations) {
        console.error(`${violation.file}:${violation.symbol}:${violation.reason}`)
      }
      process.exitCode = 1
    }
  } catch (error) {
    console.error(error?.code || error?.message || "free_tier_verify_failed")
    process.exitCode = 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
