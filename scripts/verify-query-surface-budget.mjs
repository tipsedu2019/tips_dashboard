#!/usr/bin/env node
import { verifyQuerySurfaceBudget } from "../src/lib/query-surface-budget.js"

function usageError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function parseArgs(argv) {
  const values = new Map()
  let worktree = false
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === "--worktree") {
      if (worktree) throw usageError("query_surface_argument_duplicate")
      worktree = true
      continue
    }
    if (!new Set(["--surface", "--base", "--head"]).has(token) || index + 1 >= argv.length) throw usageError("query_surface_arguments_invalid")
    if (values.has(token)) throw usageError("query_surface_argument_duplicate")
    values.set(token, argv[index + 1])
    index += 1
  }
  const surface = values.get("--surface")
  const baseSha = values.get("--base")
  const headSha = values.get("--head")
  if (!surface || !baseSha) throw usageError("query_surface_arguments_required")
  if (worktree === Boolean(headSha)) throw usageError("query_surface_mode_invalid")
  return { surface, baseSha, ...(headSha ? { headSha } : {}), includeWorktree: worktree }
}

try {
  const result = await verifyQuerySurfaceBudget(parseArgs(process.argv.slice(2)))
  if (!result.ok) {
    for (const violation of result.violations) {
      console.error(`${violation.file}:${violation.symbol}:${violation.reason}`)
    }
    process.exitCode = 1
  }
} catch (error) {
  console.error(error?.code || error?.message || "query_surface_verify_failed")
  process.exitCode = 2
}
