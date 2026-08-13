import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

export const QUERY_SURFACES = Object.freeze(["tasks", "management", "operations", "academic", "public"])
const BASELINE_SHA = "fad56ae59f6b5ec6999e3232bbe68e4c1d26b101"

// These are deliberately literal records, not path patterns. A surface task removes
// its own row only when its replacement is committed in the same change.
export const QUERY_SURFACE_DEBT_MANIFEST = Object.freeze([
  { surface: "tasks", file: "src/features/tasks/ops-task-service.ts", symbol: "readTaskScopedTable", violation: "task_id_batch_in_list", baselineSha: BASELINE_SHA },
  { surface: "tasks", file: "src/features/tasks/ops-task-service.ts", symbol: "readTaskScopedTable", violation: "list_abort_signal_missing", baselineSha: BASELINE_SHA },
  { surface: "tasks", file: "src/features/tasks/ops-task-service.ts", symbol: "readTaskScopedTable", violation: "list_retry_false_missing", baselineSha: BASELINE_SHA },
  { surface: "tasks", file: "src/features/tasks/ops-task-service.ts", symbol: "readOpsTaskWorkspaceData", violation: "list_select_star", baselineSha: BASELINE_SHA },
  { surface: "tasks", file: "src/features/tasks/ops-task-service.ts", symbol: "readOpsTaskWorkspaceData", violation: "list_abort_signal_missing", baselineSha: BASELINE_SHA },
  { surface: "tasks", file: "src/features/tasks/ops-task-service.ts", symbol: "readOpsTaskWorkspaceData", violation: "list_retry_false_missing", baselineSha: BASELINE_SHA },
  { surface: "management", file: "src/features/management/management-service.js", symbol: "selectRows", violation: "list_select_star", baselineSha: BASELINE_SHA },
  { surface: "management", file: "src/features/management/management-service.js", symbol: "selectRows", violation: "list_abort_signal_missing", baselineSha: BASELINE_SHA },
  { surface: "management", file: "src/features/management/management-service.js", symbol: "selectRows", violation: "list_retry_false_missing", baselineSha: BASELINE_SHA },
  { surface: "management", file: "src/features/management/use-management-records.ts", symbol: "useManagementRecords", violation: "list_select_star", baselineSha: BASELINE_SHA },
  { surface: "management", file: "src/features/management/use-management-records.ts", symbol: "useManagementRecords", violation: "list_abort_signal_missing", baselineSha: BASELINE_SHA },
  { surface: "management", file: "src/features/management/use-management-records.ts", symbol: "useManagementRecords", violation: "list_retry_false_missing", baselineSha: BASELINE_SHA },
  { surface: "operations", file: "src/features/operations/use-operations-workspace-data.ts", symbol: "readTable", violation: "list_select_star", baselineSha: BASELINE_SHA },
  { surface: "academic", file: "src/features/academic/use-academic-workspace-data.ts", symbol: "readTable", violation: "list_select_star", baselineSha: BASELINE_SHA },
  { surface: "public", file: "src/server/public-classes-payload.js", symbol: "buildPublicClassesPayload", violation: "list_select_star", baselineSha: BASELINE_SHA },
  { surface: "public", file: "src/server/public-classes-payload.js", symbol: "buildPublicClassesPayload", violation: "list_abort_signal_missing", baselineSha: BASELINE_SHA },
  { surface: "public", file: "src/server/public-classes-payload.js", symbol: "buildPublicClassesPayload", violation: "list_retry_false_missing", baselineSha: BASELINE_SHA },
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
  const matcher = /(?:^|\n)\s*(?:export\s+)?(?:(?:async\s+)?function\s+|const\s+)([A-Za-z_$][\w$]*)\s*(?:=\s*(?:async\s*)?)?\([^)]*\)\s*(?::[^\n{=]+)?(?:=>\s*)?\{/gu
  const starts = [...source.matchAll(matcher)]
  if (starts.length === 0) return [{ symbol: "module", source }]
  return starts.map((match, index) => ({
    symbol: match[1],
    source: source.slice(match.index, starts[index + 1]?.index ?? source.length),
  }))
}

function isListFunction(symbol, source) {
  if (/^(?:list|load|read|fetch)/u.test(symbol)) return true
  if (symbol === "buildPublicClassesPayload" || symbol === "useManagementRecords") return true
  return /\.(?:from|rpc)\(/u.test(source) && /\b(?:list|page|rows|workspace|classes|students|textbooks|curriculum)\b/iu.test(symbol)
}

function analyzeBlock({ surface, file, symbol, source }) {
  if (!isListFunction(symbol, source)) return []
  const hasRequest = /\.(?:from|rpc)\(/u.test(source)
  if (!hasRequest) return []
  const reasons = []
  if (/\.select\(\s*["']\*["']\s*\)/u.test(source)) reasons.push("list_select_star")
  if (/\.limit\(\s*(?:3[1-9]|[4-9]\d|\d{3,})\s*\)/u.test(source)) reasons.push("list_limit_exceeds_30")
  if (/\.rpc\([^]*?\bp_limit\s*:\s*(?:3[1-9]|[4-9]\d|\d{3,})\b/u.test(source)) reasons.push("rpc_page_limit_exceeds_30")
  if (!/\.abortSignal\(\s*AbortSignal\.timeout\(\s*8_000\s*\)\s*\)/u.test(source)) reasons.push("list_abort_signal_missing")
  if (!/\.retry\(\s*false\s*\)/u.test(source)) reasons.push("list_retry_false_missing")
  if (surface === "tasks" && /\.in\(\s*["']task_id["']\s*,\s*taskIds\s*\)/u.test(source)) reasons.push("task_id_batch_in_list")
  return reasons.map((reason) => ({ file, symbol, surface, reason }))
}

function exactDebtKey({ surface, file, symbol, reason }) {
  return `${surface}\u0000${file}\u0000${symbol}\u0000${reason}`
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
export async function verifyQuerySurfaceBudget({ surface, baseSha, headSha, includeWorktree = false, root = process.cwd() }) {
  assertSurface(surface)
  if (typeof baseSha !== "string" || baseSha.length === 0) throw queryBudgetError("query_surface_base_required")
  if (!includeWorktree && (typeof headSha !== "string" || headSha.length === 0)) throw queryBudgetError("query_surface_head_required")
  if (includeWorktree && headSha !== undefined) throw queryBudgetError("query_surface_mode_invalid")

  const surfaces = selectedSurfaces(surface)
  const files = changedFiles({ root, baseSha, headSha, includeWorktree })
  const allowedDebt = new Set(
    QUERY_SURFACE_DEBT_MANIFEST
      .filter((entry) => surfaces.includes(entry.surface) && entry.baselineSha === BASELINE_SHA)
      .map((entry) => exactDebtKey({ ...entry, reason: entry.violation })),
  )
  const baselineDebt = new Set()
  const violations = []
  for (const file of files) {
    const owner = surfaces.find((candidate) => isSurfacePath(candidate, file))
    if (!owner) continue
    const source = await sourceAt({ root, file, revision: headSha, includeWorktree })
    if (source === null) continue
    const baseSource = await sourceAt({ root, file, revision: baseSha, includeWorktree: false })
    if (baseSource !== null) {
      for (const block of functionBlocks(baseSource)) {
        for (const violation of analyzeBlock({ surface: owner, file, ...block })) {
          baselineDebt.add(exactDebtKey(violation))
        }
      }
    }
    for (const block of functionBlocks(source)) {
      for (const violation of analyzeBlock({ surface: owner, file, ...block })) {
        const key = exactDebtKey(violation)
        if (!allowedDebt.has(key) || !baselineDebt.has(key)) violations.push(violation)
      }
    }
  }
  violations.sort((left, right) => exactDebtKey(left).localeCompare(exactDebtKey(right)))
  return { ok: violations.length === 0, violations }
}
