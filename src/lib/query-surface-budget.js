import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

export const QUERY_SURFACES = Object.freeze(["tasks", "management", "operations", "academic", "public"])
const BASELINE_SHA = "fad56ae59f6b5ec6999e3232bbe68e4c1d26b101"

// These are deliberately literal records, not path patterns. Each one binds a
// specific baseline query chain, so moving or duplicating legacy debt is a new
// violation rather than an interchangeable allowance.
function legacyDebt(surface, file, symbol, violation, fingerprint) {
  return Object.freeze({ surface, file, symbol, violation, baselineSha: BASELINE_SHA, fingerprint })
}

export const QUERY_SURFACE_DEBT_MANIFEST = Object.freeze([
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "readTaskScopedTable", "task_id_batch_in_list", "a7385604bfb75c3de3536424a0f4a1cb7a53345d4c81a79c676159ee234224ea"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "readTaskScopedTable", "list_abort_signal_missing", "a7385604bfb75c3de3536424a0f4a1cb7a53345d4c81a79c676159ee234224ea"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "readTaskScopedTable", "list_limit_missing", "a7385604bfb75c3de3536424a0f4a1cb7a53345d4c81a79c676159ee234224ea"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "readTaskScopedTable", "list_projection_unresolved", "a7385604bfb75c3de3536424a0f4a1cb7a53345d4c81a79c676159ee234224ea"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "readTaskScopedTable", "list_retry_false_missing", "a7385604bfb75c3de3536424a0f4a1cb7a53345d4c81a79c676159ee234224ea"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "readOpsTaskWorkspaceData", "list_select_star", "747e3a4e928eabc9d7d0bf3ac549b8d1817e0aa7705befd438dfb564884ba59b"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "readOpsTaskWorkspaceData", "list_abort_signal_missing", "747e3a4e928eabc9d7d0bf3ac549b8d1817e0aa7705befd438dfb564884ba59b"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "readOpsTaskWorkspaceData", "list_limit_missing", "747e3a4e928eabc9d7d0bf3ac549b8d1817e0aa7705befd438dfb564884ba59b"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "readOpsTaskWorkspaceData", "list_retry_false_missing", "747e3a4e928eabc9d7d0bf3ac549b8d1817e0aa7705befd438dfb564884ba59b"),
  legacyDebt("management", "src/features/management/management-service.js", "selectRows", "list_select_star", "0f1136279cedcb6f70a94e65a4e0edbc2dbd30fdfca53d1e6b64249bd3f38b1d"),
  legacyDebt("management", "src/features/management/management-service.js", "selectRows", "list_abort_signal_missing", "0f1136279cedcb6f70a94e65a4e0edbc2dbd30fdfca53d1e6b64249bd3f38b1d"),
  legacyDebt("management", "src/features/management/management-service.js", "selectRows", "list_limit_missing", "0f1136279cedcb6f70a94e65a4e0edbc2dbd30fdfca53d1e6b64249bd3f38b1d"),
  legacyDebt("management", "src/features/management/management-service.js", "selectRows", "list_retry_false_missing", "0f1136279cedcb6f70a94e65a4e0edbc2dbd30fdfca53d1e6b64249bd3f38b1d"),
  legacyDebt("management", "src/features/management/use-management-records.ts", "useManagementRecords", "list_select_star", "af21c386883f8f56d09af8a847a752a11da49ea1598bd844d047e23d8570d8cb"),
  legacyDebt("management", "src/features/management/use-management-records.ts", "useManagementRecords", "list_abort_signal_missing", "af21c386883f8f56d09af8a847a752a11da49ea1598bd844d047e23d8570d8cb"),
  legacyDebt("management", "src/features/management/use-management-records.ts", "useManagementRecords", "list_limit_missing", "af21c386883f8f56d09af8a847a752a11da49ea1598bd844d047e23d8570d8cb"),
  legacyDebt("management", "src/features/management/use-management-records.ts", "useManagementRecords", "list_retry_false_missing", "af21c386883f8f56d09af8a847a752a11da49ea1598bd844d047e23d8570d8cb"),
  legacyDebt("operations", "src/features/operations/use-operations-workspace-data.ts", "readTable", "list_select_star", "3f4391cb9a079824d1e0f8dd76c7a6a505646944cd4dde5ee2c1cb7e8c7f0d13"),
  legacyDebt("operations", "src/features/operations/use-operations-workspace-data.ts", "readTable", "list_limit_missing", "3f4391cb9a079824d1e0f8dd76c7a6a505646944cd4dde5ee2c1cb7e8c7f0d13"),
  legacyDebt("academic", "src/features/academic/use-academic-workspace-data.ts", "readTable", "list_select_star", "1553c56f5cdbaae15269a59b7a6d725aed4e4c6893bd61e73d03a5bea613db51"),
  legacyDebt("academic", "src/features/academic/use-academic-workspace-data.ts", "readTable", "list_limit_missing", "1553c56f5cdbaae15269a59b7a6d725aed4e4c6893bd61e73d03a5bea613db51"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_select_star", "1202314591fab131113d1fa2021deab675667f30074dff892b953d6799bfe8b3"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_select_star", "65675ce792f82f708937676e3efda7f348c361901dd145fd0bc28fd7256e5e65"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_select_star", "3b3a4a87382151769838bfef46641009ae56b1b4477beb01ce083777c781e2e3"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_projection_unresolved", "b9643fd500c05acb840d52f84feea2c11d52a7cdede73aae61e0d92e97c7cb26"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_abort_signal_missing", "b9643fd500c05acb840d52f84feea2c11d52a7cdede73aae61e0d92e97c7cb26"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_abort_signal_missing", "1202314591fab131113d1fa2021deab675667f30074dff892b953d6799bfe8b3"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_abort_signal_missing", "65675ce792f82f708937676e3efda7f348c361901dd145fd0bc28fd7256e5e65"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_abort_signal_missing", "3b3a4a87382151769838bfef46641009ae56b1b4477beb01ce083777c781e2e3"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_limit_missing", "b9643fd500c05acb840d52f84feea2c11d52a7cdede73aae61e0d92e97c7cb26"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_limit_missing", "1202314591fab131113d1fa2021deab675667f30074dff892b953d6799bfe8b3"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_limit_missing", "65675ce792f82f708937676e3efda7f348c361901dd145fd0bc28fd7256e5e65"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_limit_missing", "3b3a4a87382151769838bfef46641009ae56b1b4477beb01ce083777c781e2e3"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_retry_false_missing", "b9643fd500c05acb840d52f84feea2c11d52a7cdede73aae61e0d92e97c7cb26"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_retry_false_missing", "1202314591fab131113d1fa2021deab675667f30074dff892b953d6799bfe8b3"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_retry_false_missing", "65675ce792f82f708937676e3efda7f348c361901dd145fd0bc28fd7256e5e65"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_retry_false_missing", "3b3a4a87382151769838bfef46641009ae56b1b4477beb01ce083777c781e2e3"),
])

const SURFACE_PREFIXES = Object.freeze({
  tasks: ["src/features/tasks/"],
  management: ["src/features/management/"],
  operations: ["src/features/operations/"],
  academic: ["src/features/academic/"],
  public: ["src/server/public-", "src/app/api/public-classes/", "src/app/classes/"],
})

function queryBudgetError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function git(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
  } catch (error) {
    throw queryBudgetError(`query_surface_git_${String(error?.status ?? "failed")}`)
  }
}

function assertSurface(surface) {
  if (surface !== "all" && !QUERY_SURFACES.includes(surface)) throw queryBudgetError("query_surface_unknown")
}

function selectedSurfaces(surface) {
  return surface === "all" ? QUERY_SURFACES : [surface]
}

function isSurfacePath(surface, file) {
  return SURFACE_PREFIXES[surface].some((prefix) => file.startsWith(prefix))
}

function functionBlocks(source) {
  const matcher = /(?:^|\n)(?:export\s+)?(?:(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/gu
  const starts = [...source.matchAll(matcher)]
  if (starts.length === 0) return [{ symbol: "module", source }]
  const blocks = []
  if (source.slice(0, starts[0].index).trim()) blocks.push({ symbol: "module", source: source.slice(0, starts[0].index) })
  blocks.push(...starts.map((match, index) => ({
    symbol: match[1] ?? match[2],
    source: source.slice(match.index, starts[index + 1]?.index ?? source.length),
  })))
  return blocks
}

function primitiveConstants(source) {
  const values = new Map()
  const matcher = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:(["'])([^"'\n]*)\2|(-?\d+(?:\.\d+)?))\s*(?:;|\n)/gu
  for (const match of source.matchAll(matcher)) {
    values.set(match[1], match[3] ?? Number(match[4]))
  }
  return values
}

function argumentValue(argument, constants) {
  const trimmed = argument.trim()
  const quoted = trimmed.match(/^(["'])(.*)\1$/u)
  if (quoted) return quoted[2]
  if (/^-?\d+(?:\.\d+)?$/u.test(trimmed)) return Number(trimmed)
  return constants.get(trimmed)
}

function queryChainEnd(source, start, nextStart) {
  let depth = 0
  for (let index = start; index < (nextStart ?? source.length); index += 1) {
    const character = source[index]
    if (character === "(" || character === "[" || character === "{") depth += 1
    else if (character === ")" || character === "]" || character === "}") depth = Math.max(0, depth - 1)
    else if (character === ";" && depth === 0) return index + 1
    else if (character === "\n" && depth === 0) {
      const remainder = source.slice(index + 1, nextStart).trimStart()
      if (!remainder.startsWith(".") && !remainder.startsWith("?.")) return index
    }
  }
  return nextStart ?? source.length
}

function queryChains(source) {
  const matcher = /(?:\.\s*(from|rpc)\s*\(|\?\.\s*(from|rpc)\s*\?\.\s*\(|\b(?:client|supabase)\s*(?:\?\.)?\[\s*[^\]]+\s*\]\s*(?:\?\.)?\()/gu
  const matches = [...source.matchAll(matcher)]
  return matches.map((match, ordinal) => ({
    ordinal,
    directMethod: match[1] ?? match[2] ?? null,
    start: match.index,
    prefix: source.slice(0, match.index),
    chain: source.slice(match.index, queryChainEnd(source, match.index, matches[ordinal + 1]?.index)),
  }))
}

function normalizeQuerySource(source) {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, " ").replace(/\s+/gu, " ").trim()
}

export function createQueryChainFingerprint({ symbol, ordinal, prefix, chain }) {
  return createHash("sha256")
    .update(`${symbol}\u0000${ordinal}\u0000${normalizeQuerySource(prefix)}\u0000${normalizeQuerySource(chain)}`)
    .digest("hex")
}

function chainHasWildcardProjection(value) {
  return value.split(",").some((field) => field.trim() === "*")
}

function analyzeChain({ surface, file, symbol, source, query }) {
  const constants = primitiveConstants(source)
  const reasons = []
  if (query.directMethod === null) reasons.push("list_query_method_unresolved")
  if (query.directMethod === "from") {
    const projections = [...query.chain.matchAll(/\.select\s*\(\s*([^)]*?)\s*\)/gu)]
    if (projections.length === 0) reasons.push("list_projection_missing")
    for (const match of projections) {
      const value = argumentValue(match[1], constants)
      if (value === undefined) reasons.push("list_projection_unresolved")
      else if (typeof value !== "string" || value.trim() === "") reasons.push("list_projection_invalid")
      else if (chainHasWildcardProjection(value)) reasons.push("list_select_star")
    }
    const limits = [...query.chain.matchAll(/\.limit\s*\(\s*([^)]*?)\s*\)/gu)]
    const singleResult = /\.(?:maybeSingle|single)\s*\(\s*\)/u.test(query.chain)
    const ranges = [...query.chain.matchAll(/\.range\s*\(\s*([^,)]*)\s*,\s*([^)]*)\s*\)/gu)]
    if (limits.length === 0 && !singleResult && ranges.length === 0) reasons.push("list_limit_missing")
    for (const match of limits) {
      const value = argumentValue(match[1], constants)
      if (value === undefined) reasons.push("list_limit_unresolved")
      else if (typeof value !== "number" || !Number.isInteger(value) || value < 1) reasons.push("list_limit_invalid")
      else if (value > 30) reasons.push("list_limit_exceeds_30")
    }
    for (const match of ranges) {
      const first = argumentValue(match[1], constants)
      const last = argumentValue(match[2], constants)
      if (!Number.isInteger(first) || !Number.isInteger(last)) reasons.push("list_range_unresolved")
      else if (first < 0 || last < first || last - first + 1 > 30) reasons.push("list_range_invalid")
    }
  }
  if (query.directMethod === "rpc") {
    const limits = [...query.chain.matchAll(/\bp_limit\s*:\s*([^,}\n]+)/gu)]
    if (limits.length === 0) reasons.push("rpc_page_limit_missing")
    for (const match of limits) {
      const value = argumentValue(match[1], constants)
      if (value === undefined) reasons.push("rpc_page_limit_unresolved")
      else if (typeof value !== "number" || !Number.isInteger(value) || value < 1) reasons.push("rpc_page_limit_invalid")
      else if (value > 30) reasons.push("rpc_page_limit_exceeds_30")
    }
  }
  if (!/\.abortSignal\(\s*AbortSignal\.timeout\(\s*8_000\s*\)\s*\)/u.test(query.chain)) reasons.push("list_abort_signal_missing")
  if (!/\.retry\(\s*false\s*\)/u.test(query.chain)) reasons.push("list_retry_false_missing")
  if (surface === "tasks" && /\.in\(\s*["']task_id["']\s*,\s*taskIds\s*\)/u.test(query.chain)) reasons.push("task_id_batch_in_list")
  const fingerprint = createQueryChainFingerprint({ symbol, ordinal: query.ordinal, prefix: query.prefix, chain: query.chain })
  return reasons.map((reason) => ({ file, symbol, surface, reason, fingerprint }))
}

function analyzeBlock({ surface, file, symbol, source }) {
  return queryChains(source).flatMap((query) => analyzeChain({ surface, file, symbol, source, query }))
}

export function inspectQuerySurfaceSource({ surface, file, source }) {
  return functionBlocks(source).flatMap((block) => analyzeBlock({ surface, file, ...block }))
}

function countedViolations(source, surface, file) {
  const counts = new Map()
  for (const violation of inspectQuerySurfaceSource({ surface, file, source })) {
      const key = exactDebtKey(violation)
      counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function exactDebtKey({ surface, file, symbol, reason }) {
  return `${surface}\u0000${file}\u0000${symbol}\u0000${reason}\u0000${arguments[0].fingerprint ?? ""}`
}

async function sourceAt({ root, file, revision, includeWorktree }) {
  if (includeWorktree) return readFile(resolve(root, file), "utf8")
  try {
    return git(root, ["show", `${revision}:${file}`])
  } catch (error) {
    if (error.code?.startsWith("query_surface_git_")) return null
    throw error
  }
}

function changedFiles({ root, baseSha, headSha, includeWorktree }) {
  const range = includeWorktree ? ["diff", "--name-only", baseSha] : ["diff", "--name-only", `${baseSha}..${headSha}`]
  const changed = git(root, range).split("\n").filter(Boolean)
  if (!includeWorktree) return changed
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean)
  return [...new Set([...changed, ...untracked])]
}

/**
 * Checks changed list-query source files. Existing debt is accepted only when an
 * exact manifest record names its surface, file, symbol, and violation code.
 */
export async function verifyQuerySurfaceBudget({ surface, baseSha, headSha, includeWorktree = false, root = process.cwd(), debtManifest = QUERY_SURFACE_DEBT_MANIFEST }) {
  assertSurface(surface)
  if (typeof baseSha !== "string" || baseSha.length === 0) throw queryBudgetError("query_surface_base_required")
  if (!includeWorktree && (typeof headSha !== "string" || headSha.length === 0)) throw queryBudgetError("query_surface_head_required")
  if (includeWorktree && headSha !== undefined) throw queryBudgetError("query_surface_mode_invalid")

  const surfaces = selectedSurfaces(surface)
  const files = changedFiles({ root, baseSha, headSha, includeWorktree })
  if (!Array.isArray(debtManifest)) throw queryBudgetError("query_surface_debt_manifest_invalid")
  const relevantDebt = debtManifest.filter((entry) => surfaces.includes(entry.surface))
  const allowedDebt = new Set()
  for (const entry of relevantDebt) {
    if (!entry || typeof entry.file !== "string" || typeof entry.symbol !== "string" || typeof entry.violation !== "string"
      || typeof entry.baselineSha !== "string" || typeof entry.fingerprint !== "string" || !/^[0-9a-f]{40}$/u.test(entry.baselineSha)
      || !/^[0-9a-f]{64}$/u.test(entry.fingerprint)) throw queryBudgetError("query_surface_debt_manifest_invalid")
    const baselineSource = await sourceAt({ root, file: entry.file, revision: entry.baselineSha, includeWorktree: false })
    if (baselineSource === null) throw queryBudgetError("query_surface_debt_manifest_invalid")
    const baselineKey = exactDebtKey({ surface: entry.surface, file: entry.file, symbol: entry.symbol, reason: entry.violation, fingerprint: entry.fingerprint })
    const baselineMatches = countedViolations(baselineSource, entry.surface, entry.file)
    if (!baselineMatches.has(baselineKey)) throw queryBudgetError("query_surface_debt_manifest_invalid")
    allowedDebt.add(baselineKey)
  }
  const violations = []
  for (const file of files) {
    const owner = surfaces.find((candidate) => isSurfacePath(candidate, file))
    if (!owner) continue
    const source = await sourceAt({ root, file, revision: headSha, includeWorktree })
    if (source === null) continue
    for (const violation of inspectQuerySurfaceSource({ surface: owner, file, source })) {
        const key = exactDebtKey(violation)
        if (!allowedDebt.has(key)) violations.push(violation)
    }
  }
  violations.sort((left, right) => exactDebtKey(left).localeCompare(exactDebtKey(right)))
  return {
    ok: violations.length === 0,
    violations: violations.map(({ fingerprint, ...violation }) => violation),
  }
}
