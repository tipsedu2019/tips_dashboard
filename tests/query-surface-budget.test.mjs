import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"

import {
  inspectQuerySurfaceSource,
  QUERY_SURFACE_DEBT_MANIFEST,
  verifyQuerySurfaceBudget,
} from "../src/lib/query-surface-budget.js"

async function createFixtureRepository(files) {
  const root = await mkdtemp(join(tmpdir(), "query-surface-budget-"))
  for (const [relativePath, contents] of Object.entries(files)) {
    const path = join(root, relativePath)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, contents)
  }
  execFileSync("git", ["init", "--quiet"], { cwd: root })
  execFileSync("git", ["config", "user.email", "query-budget@example.invalid"], { cwd: root })
  execFileSync("git", ["config", "user.name", "Query budget fixture"], { cwd: root })
  execFileSync("git", ["add", "."], { cwd: root })
  execFileSync("git", ["commit", "--quiet", "-m", "baseline"], { cwd: root })
  return root
}

function commitFixture(root) {
  execFileSync("git", ["add", "."], { cwd: root })
  execFileSync("git", ["commit", "--quiet", "-m", "candidate"], { cwd: root })
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
}

async function verifyFixture({ surface = "tasks", file = "src/features/tasks/list-tasks.ts", baselineSource = "export const untouched = true\n", source, debtManifest }) {
  const root = await createFixtureRepository({ [file]: baselineSource })
  try {
    const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
    await writeFile(join(root, file), source)
    const headSha = commitFixture(root)
    const manifest = typeof debtManifest === "function" ? debtManifest(baseSha) : debtManifest
    return await verifyQuerySurfaceBudget({ surface, baseSha, headSha, root, debtManifest: manifest ?? [] })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test("query budget verifier identifies a new list select-star by exact file, symbol, and reason", async () => {
  const result = await verifyFixture({
    source: `export async function listTasks(client) {
  return client.from("ops_tasks").select("*").limit(30).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
  })

  assert.deepEqual(result.ok, false)
  assert.deepEqual(result.violations, [{
    file: "src/features/tasks/list-tasks.ts",
    symbol: "listTasks",
    surface: "tasks",
    reason: "list_select_star",
  }])
})

test("query budget verifier rejects an over-budget list limit", async () => {
  const result = await verifyFixture({
    source: `export async function listTasks(client) {
  return client.from("ops_tasks").select("id").limit(31).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
  })

  assert.deepEqual(result.violations, [{
    file: "src/features/tasks/list-tasks.ts",
    symbol: "listTasks",
    surface: "tasks",
    reason: "list_limit_exceeds_30",
  }])
})

test("query budget verifier inspects manifest-listed symbols even when their names do not look like list paths", async () => {
  const result = await verifyFixture({
    surface: "management",
    file: "src/features/management/management-service.js",
    source: `async function selectRows(client, table) {
  return client.from(table).select("*")
}
`,
  })

  assert.deepEqual(result.violations, [
    {
      file: "src/features/management/management-service.js",
      symbol: "selectRows",
      surface: "management",
      reason: "list_abort_signal_missing",
    },
    {
      file: "src/features/management/management-service.js",
      symbol: "selectRows",
      surface: "management",
      reason: "list_limit_missing",
    },
    {
      file: "src/features/management/management-service.js",
      symbol: "selectRows",
      surface: "management",
      reason: "list_order_missing",
    },
    {
      file: "src/features/management/management-service.js",
      symbol: "selectRows",
      surface: "management",
      reason: "list_retry_false_missing",
    },
    {
      file: "src/features/management/management-service.js",
      symbol: "selectRows",
      surface: "management",
      reason: "list_select_star",
    },
  ])
})

test("query budget verifier resolves local projection and limit constants without relying on a list-like symbol name", async () => {
  const result = await verifyFixture({
    source: `export async function opaque(client) {
  const columns = "*"
  const pageSize = 31
  return client.from("ops_tasks").select(columns).limit(pageSize).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
  })

  assert.deepEqual(result.violations, [
    {
      file: "src/features/tasks/list-tasks.ts",
      symbol: "opaque",
      surface: "tasks",
      reason: "list_limit_exceeds_30",
    },
    {
      file: "src/features/tasks/list-tasks.ts",
      symbol: "opaque",
      surface: "tasks",
      reason: "list_select_star",
    },
  ])
})

test("manifest-listed list symbols reject an opaque projection expression", async () => {
  const result = await verifyFixture({
    surface: "management",
    file: "src/features/management/management-service.js",
    source: `async function selectRows(client, table) {
  const projection = ["*"].join("")
  return client.from(table).select(projection).limit(30).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
  })

  assert.deepEqual(result.violations, [{
    file: "src/features/management/management-service.js",
    symbol: "selectRows",
    surface: "management",
    reason: "list_projection_unresolved",
  }])
})

test("manifest-listed list symbols reject an opaque limit expression", async () => {
  const result = await verifyFixture({
    surface: "management",
    file: "src/features/management/management-service.js",
    source: `async function selectRows(client, table) {
  const pageSize = Number("31")
  return client.from(table).select("id").limit(pageSize).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
  })

  assert.deepEqual(result.violations, [{
    file: "src/features/management/management-service.js",
    symbol: "selectRows",
    surface: "management",
    reason: "list_limit_unresolved",
  }])
})

test("manifest-listed list symbols reject a computed query entrypoint", async () => {
  const result = await verifyFixture({
    surface: "management",
    file: "src/features/management/management-service.js",
    source: `async function selectRows(client, table) {
  const method = getMethod()
  return client[method](table).select("id").limit(30).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
  })

  assert.deepEqual(result.violations, [{
    file: "src/features/management/management-service.js",
    symbol: "selectRows",
    surface: "management",
    reason: "list_query_method_unresolved",
  }])
})

test("query budget rejects a second occurrence of the same legacy violation", async () => {
  const baselineSource = `async function selectRows(client, table) {
  await client.from(table).select("*").limit(30).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
  return []
}
`
  const result = await verifyFixture({
    surface: "management",
    file: "src/features/management/management-service.js",
    baselineSource,
    source: `async function selectRows(client, table) {
  await client.from(table).select("*").limit(30).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
  return client.from(table).select("*").limit(30).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
    debtManifest: (baseSha) => [{
      surface: "management",
      file: "src/features/management/management-service.js",
      symbol: "selectRows",
      violation: "list_select_star",
      baselineSha: baseSha,
      fingerprint: inspectQuerySurfaceSource({
        surface: "management",
        file: "src/features/management/management-service.js",
        source: baselineSource,
      }).find((violation) => violation.reason === "list_select_star").fingerprint,
    }],
  })

  assert.deepEqual(result.violations, [{
    file: "src/features/management/management-service.js",
    symbol: "selectRows",
    surface: "management",
    reason: "list_select_star",
  }])
})

test("an unchanged legacy chain is outside the diff candidate set when a safe neighbor is added", async () => {
  const baselineSource = `async function selectRows(client, table) {
  return client.from(table).select("*").limit(30).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`
  const result = await verifyFixture({
    surface: "management",
    file: "src/features/management/management-service.js",
    baselineSource,
    source: `async function selectRows(client, table) {
  return client.from(table).select("*").limit(30).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
  const projection = "id"
  await client.from(table).select(projection).limit(30).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
    debtManifest: (baseSha) => [{
      surface: "management",
      file: "src/features/management/management-service.js",
      symbol: "selectRows",
      violation: "list_select_star",
      baselineSha: baseSha,
      fingerprint: inspectQuerySurfaceSource({
        surface: "management",
        file: "src/features/management/management-service.js",
        source: baselineSource,
      }).find((violation) => violation.reason === "list_select_star").fingerprint,
    }],
  })

  assert.deepEqual(result, { ok: true, violations: [] })
})

test("all direct owned-surface query chains are inspected even without a list marker", async () => {
  const result = await verifyFixture({
    source: `async function opaque(client) {
  return client.from("ops_tasks").select("*").order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
  })

  assert.deepEqual(result.violations, [
    { file: "src/features/tasks/list-tasks.ts", symbol: "opaque", surface: "tasks", reason: "list_limit_missing" },
    { file: "src/features/tasks/list-tasks.ts", symbol: "opaque", surface: "tasks", reason: "list_select_star" },
  ])
})

test("query controls are enforced per request chain rather than borrowed from a neighboring request", async () => {
  const result = await verifyFixture({
    source: `async function opaque(client) {
  await client.from("ops_tasks").select("id").limit(30).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
  return client.from("ops_tasks").select("id").limit(30).order("id").abortSignal(AbortSignal.timeout(8_000))
}
`,
  })

  assert.deepEqual(result.violations, [{
    file: "src/features/tasks/list-tasks.ts",
    symbol: "opaque",
    surface: "tasks",
    reason: "list_retry_false_missing",
  }])
})

test("query extraction covers module prefixes and single-parameter arrow functions", async () => {
  const result = await verifyFixture({
    source: `client.from("ops_tasks").select("id").limit(30).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
export const loadRows = async client => client.from("ops_tasks").select("*").order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
`,
  })

  assert.deepEqual(result.violations, [
    { file: "src/features/tasks/list-tasks.ts", symbol: "loadRows", surface: "tasks", reason: "list_limit_missing" },
    { file: "src/features/tasks/list-tasks.ts", symbol: "loadRows", surface: "tasks", reason: "list_select_star" },
  ])
})

test("nonliteral optional computed query entrypoints are rejected outside manifest-listed symbols", async () => {
  const result = await verifyFixture({
    source: `async function opaque(client, method) {
  return client?.[method]?.("ops_tasks").select("id").limit(30).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
  })

  assert.deepEqual(result.violations, [{
    file: "src/features/tasks/list-tasks.ts",
    symbol: "opaque",
    surface: "tasks",
    reason: "list_query_method_unresolved",
  }])
})

test("manifest-listed list symbols inspect direct queries even when no page limit is present", async () => {
  const result = await verifyFixture({
    surface: "management",
    file: "src/features/management/management-service.js",
    source: `async function selectRows(client, table) {
  return client.from(table).select("*").order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
  })

  assert.deepEqual(result.violations, [
    {
      file: "src/features/management/management-service.js",
      symbol: "selectRows",
      surface: "management",
      reason: "list_limit_missing",
    },
    {
      file: "src/features/management/management-service.js",
      symbol: "selectRows",
      surface: "management",
      reason: "list_select_star",
    },
  ])
})

test("manifest-listed list symbols reject nonliteral and optional computed query entrypoints", async () => {
  const result = await verifyFixture({
    surface: "management",
    file: "src/features/management/management-service.js",
    source: `async function selectRows(client, table) {
  const method = "from"
  return client?.[method]?.(table).select("id").limit(30).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
  })

  assert.deepEqual(result.violations, [{
    file: "src/features/management/management-service.js",
    symbol: "selectRows",
    surface: "management",
    reason: "list_query_method_unresolved",
  }])
})

test("statically resolved explicit list projection and page limit remain allowed", async () => {
  const result = await verifyFixture({
    surface: "management",
    file: "src/features/management/management-service.js",
    source: `async function selectRows(client, table) {
  const projection = "id,name"
  const pageSize = 30
  return client.from(table).select(projection).limit(pageSize).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
  })

  assert.deepEqual(result, { ok: true, violations: [] })
})

test("exact-key single-row and ordered bounded range query chains are explicit list-limit exemptions", async () => {
  const result = await verifyFixture({
    source: `async function readRows(client, id) {
  await client.from("ops_tasks").select("id").eq("id", id).single().abortSignal(AbortSignal.timeout(8_000)).retry(false)
  return client.from("ops_tasks").select("id").range(0, 29).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
  })

  assert.deepEqual(result, { ok: true, violations: [] })
})

test("query budget rejects direct RPC query chains without an explicit page limit", async () => {
  const result = await verifyFixture({
    source: `async function readRows(client) {
  return client.rpc("list_ops_task_page_v1", {}).abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
  })

  assert.deepEqual(result.violations, [{
    file: "src/features/tasks/list-tasks.ts",
    symbol: "readRows",
    surface: "tasks",
    reason: "rpc_page_limit_missing",
  }])
})

test("query budget allows the exact task stats scalar RPC without a page limit", async () => {
  const result = await verifyFixture({
    source: `export async function readStats(client) {
  return client.rpc("get_ops_task_list_stats_v1", { p_type: "general", p_filters: {} })
    .abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
  })
  assert.deepEqual(result, { ok: true, violations: [] })
})

test("query budget allows exact operations scalar and internally bounded catalog RPCs", async () => {
  const result = await verifyFixture({
    surface: "operations",
    file: "src/features/operations/operations-read-service.js",
    source: `export async function readOperations(client) {
  await client.rpc("get_operations_calendar_range_v1", { p_date_from: "2026-08-01", p_date_to: "2026-08-31" }).abortSignal(AbortSignal.timeout(8_000)).retry(false)
  await client.rpc("get_operations_annual_board_v1", { p_academic_year: 2026 }).abortSignal(AbortSignal.timeout(8_000)).retry(false)
  await client.rpc("get_academic_event_detail_v1", { p_event_id: "event-1" }).abortSignal(AbortSignal.timeout(8_000)).retry(false)
  await client.rpc("get_class_schedule_v1", { p_class_id: "class-1", p_date_from: "2026-08-01", p_date_to: "2026-08-31" }).abortSignal(AbortSignal.timeout(8_000)).retry(false)
  await client.rpc("get_operations_class_lesson_design_detail_v1", { p_class_id: "class-1" }).abortSignal(AbortSignal.timeout(8_000)).retry(false)
  await client.rpc("list_operations_catalogs_v1", {}).abortSignal(AbortSignal.timeout(8_000)).retry(false)
  return client.rpc("list_active_science_subject_areas_v1", {}).abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
  })

  assert.deepEqual(result, { ok: true, violations: [] })
})

test("query budget reports an RPC without an argument envelope instead of throwing", async () => {
  const result = await verifyFixture({
    source: `async function readRows(client) {
  return client.rpc("list_ops_task_page_v1").abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
  })

  assert.deepEqual(result.violations, [{
    file: "src/features/tasks/list-tasks.ts",
    symbol: "readRows",
    surface: "tasks",
    reason: "rpc_page_limit_missing",
  }])
})

test("query budget rejects wildcard fields with whitespace or mixed projections", async () => {
  const result = await verifyFixture({
    source: `async function readRows(client) {
  await client.from("ops_tasks").select(" *, name ").limit(30).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
  return client.from("ops_tasks").select("id, *").limit(30).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
  })

  assert.deepEqual(result.violations, [
    { file: "src/features/tasks/list-tasks.ts", symbol: "readRows", surface: "tasks", reason: "list_select_star" },
    { file: "src/features/tasks/list-tasks.ts", symbol: "readRows", surface: "tasks", reason: "list_select_star" },
  ])
})

test("statically resolved bounded RPC page arguments remain allowed", async () => {
  const result = await verifyFixture({
    source: `export async function listTasks(client) {
  return client.rpc("list_ops_task_page_v1", { p_limit: 30 }).abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
  })

  assert.deepEqual(result, { ok: true, violations: [] })
})

test("query budget verifier rejects an RPC page limit over 30", async () => {
  const result = await verifyFixture({
    source: `export async function listTasks(client) {
  return client.rpc("list_ops_task_page_v1", { p_limit: 31 }).abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
  })

  assert.deepEqual(result.violations, [{
    file: "src/features/tasks/list-tasks.ts",
    symbol: "listTasks",
    surface: "tasks",
    reason: "rpc_page_limit_exceeds_30",
  }])
})

test("query budget verifier rejects list requests without timeout and no-retry protections", async () => {
  const result = await verifyFixture({
    source: `export async function listTasks(client) {
  return client.from("ops_tasks").select("id").limit(30).order("id")
}
`,
  })

  assert.deepEqual(result.violations, [
    {
      file: "src/features/tasks/list-tasks.ts",
      symbol: "listTasks",
      surface: "tasks",
      reason: "list_abort_signal_missing",
    },
    {
      file: "src/features/tasks/list-tasks.ts",
      symbol: "listTasks",
      surface: "tasks",
      reason: "list_retry_false_missing",
    },
  ])
})

test("query budget verifier rejects task child list fan-out by task IDs", async () => {
  const result = await verifyFixture({
    source: `export async function listTasks(client, taskIds) {
  return client.from("ops_task_comments").select("id").in("task_id", taskIds).limit(30).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
  })

  assert.deepEqual(result.violations, [{
    file: "src/features/tasks/list-tasks.ts",
    symbol: "listTasks",
    surface: "tasks",
    reason: "task_id_batch_in_list",
  }])
})

test("query budget worktree mode includes unstaged source additions", async () => {
  const root = await createFixtureRepository({ "src/features/tasks/list-tasks.ts": "export const untouched = true\n" })
  try {
    await writeFile(join(root, "src/features/tasks/list-tasks.ts"), `export async function listTasks(client) {
  return client.from("ops_tasks").select("*").limit(30).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`)
    const result = await verifyQuerySurfaceBudget({ surface: "tasks", baseSha: "HEAD", includeWorktree: true, root, debtManifest: [] })
    assert.deepEqual(result.violations, [{
      file: "src/features/tasks/list-tasks.ts",
      symbol: "listTasks",
      surface: "tasks",
      reason: "list_select_star",
    }])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("legacy query debt is an exact literal manifest and not a wildcard exception", () => {
  assert.ok(QUERY_SURFACE_DEBT_MANIFEST.length > 0)
  for (const entry of QUERY_SURFACE_DEBT_MANIFEST) {
    assert.deepEqual(Object.keys(entry).sort(), ["baselineSha", "file", "fingerprint", "surface", "symbol", "violation"].sort())
    assert.match(entry.file, /^src\/[\w./-]+\.(?:ts|tsx|js)$/u)
    assert.doesNotMatch(entry.file, /[*?]/u)
    assert.match(entry.symbol, /^[A-Za-z_$][\w$]*$/u)
    assert.match(entry.baselineSha, /^[0-9a-f]{40}$/u)
    assert.match(entry.fingerprint, /^[0-9a-f]{64}$/u)
    assert.ok(["tasks", "management", "operations", "academic", "public"].includes(entry.surface))
  }
})

test("only the three named legacy public compatibility projections are unpaged", () => {
  const source = `async function buildPublicClassesPayload(client) {
  const PUBLIC_CLASSES_SUMMARY_COMPATIBILITY_PROJECTION = "id"
  const summary = client.from("classes").select(PUBLIC_CLASSES_SUMMARY_COMPATIBILITY_PROJECTION)
  const full = [
    client.from("classes").select("id,name"),
    client.from("textbooks").select("id,title"),
    client.from("progress_logs").select("id,class_id"),
  ]
  const accidentalList = client.from("students").select("id")
  const accidentalWildcard = client.from("teachers").select("*")
  return { summary, full, accidentalList, accidentalWildcard }
}`
  const violations = inspectQuerySurfaceSource({
    surface: "public",
    file: "src/server/public-classes-payload.js",
    source,
  })

  assert.equal(violations.some((violation) => violation.reason === "list_limit_missing" && violation.startLine < 8), false)
  assert.ok(violations.some((violation) => violation.reason === "list_limit_missing" && violation.startLine === 9))
  assert.ok(violations.some((violation) => violation.reason === "list_order_missing" && violation.startLine === 9))
  assert.ok(violations.some((violation) => violation.reason === "list_select_star" && violation.startLine === 10))
})

test("the cache invalidation role RPC is an exact scalar RPC, not a pageable list", () => {
  const violations = inspectQuerySurfaceSource({
    surface: "public",
    file: "src/app/api/public-classes/cache/invalidate/route.ts",
    source: `async function authenticate(client) {
  return client.rpc("current_dashboard_role").abortSignal(AbortSignal.timeout(8000)).retry(false)
}`,
  })
  assert.equal(violations.some((violation) => violation.reason === "rpc_page_limit_missing"), false)
})

test("query budget verifier fails closed for an unknown surface", async () => {
  await assert.rejects(
    verifyQuerySurfaceBudget({ surface: "everything", baseSha: "HEAD", root: process.cwd() }),
    { code: "query_surface_unknown" },
  )
})

test("query budget CLI requires exactly one CI or worktree mode", () => {
  const script = new URL("../scripts/verify-query-surface-budget.mjs", import.meta.url)
  const missingMode = spawnSync(process.execPath, [script.pathname, "--surface", "tasks", "--base", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
  })
  assert.equal(missingMode.status, 2)
  assert.match(missingMode.stderr, /query_surface_mode_invalid/u)

  const unknownSurface = spawnSync(process.execPath, [script.pathname, "--surface", "unknown", "--base", "HEAD", "--worktree"], {
    cwd: process.cwd(),
    encoding: "utf8",
  })
  assert.equal(unknownSurface.status, 2)
  assert.match(unknownSurface.stderr, /query_surface_unknown/u)

  const worktree = spawnSync(process.execPath, [script.pathname, "--surface", "tasks", "--base", "HEAD", "--worktree"], {
    cwd: process.cwd(),
    encoding: "utf8",
  })
  assert.equal(worktree.status, 0)
})

test("query budget compares a changed real legacy task source against its baseline delta", async () => {
  const file = "src/features/tasks/ops-task-service.ts"
  const baselineSha = "fad56ae59f6b5ec6999e3232bbe68e4c1d26b101"
  const baselineSource = execFileSync("git", ["show", `${baselineSha}:${file}`], { cwd: process.cwd(), encoding: "utf8" })
  const currentSource = execFileSync("git", ["show", `HEAD:${file}`], { cwd: process.cwd(), encoding: "utf8" })

  const unchangedDebt = await verifyFixture({
    file,
    baselineSource,
    source: `${currentSource}\n// Task 2 changes this legacy source without adding a request.\n`,
  })
  assert.deepEqual(unchangedDebt, { ok: true, violations: [] })

  const addedViolation = await verifyFixture({
    file,
    baselineSource,
    source: `${currentSource}\nexport const queryBudgetInjected = (client) => client.from("ops_tasks").select("*").limit(30).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)\n`,
  })
  assert.deepEqual(addedViolation.violations, [{
    file,
    symbol: "queryBudgetInjected",
    surface: "tasks",
    reason: "list_select_star",
  }])
})

test("receiver-aware query analysis accepts Supabase aliases, optional calls, multiline reassignment, and nested projections", async () => {
  const result = await verifyFixture({
    source: `async function load(client) {
  const db = client
  let query = db["from"]("ops_tasks")
  query = query
    .select("id, owner:profiles(id, name)")
    .limit(30)
    .order("id")
  query = query.abortSignal(AbortSignal.timeout(8_000)).retry(false)
  const unrelated = Array.from([1, 2, 3])
  return client.from?.("ops_tasks").select("id, class:classes(id, teacher:profiles(id))").limit(30).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
  })

  assert.deepEqual(result, { ok: true, violations: [] })
})

test("receiver-aware query analysis rejects nonliteral methods and unprovable Supabase-like receivers", async () => {
  const result = await verifyFixture({
    source: `async function load(client, method, makeOther) {
  const db = client
  await db[method]("ops_tasks").select("id").limit(30).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
  const other = makeOther()
  return other.from("ops_tasks").select("id").limit(30).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
  })

  assert.deepEqual(result.violations, [
    { file: "src/features/tasks/list-tasks.ts", symbol: "load", surface: "tasks", reason: "list_query_method_unresolved" },
    { file: "src/features/tasks/list-tasks.ts", symbol: "load", surface: "tasks", reason: "list_query_receiver_unresolved" },
  ])
})

test("receiver-aware query analysis fails closed for an unprovable bare from request while ignoring Array.from", async () => {
  const result = await verifyFixture({
    source: `async function load(makeOther) {
  const values = Array.from([1, 2, 3])
  return makeOther().from("ops_tasks")
}
`,
  })

  assert.deepEqual(result.violations, [{
    file: "src/features/tasks/list-tasks.ts",
    symbol: "load",
    surface: "tasks",
    reason: "list_query_receiver_unresolved",
  }])
})

test("manifest is the sole legacy-debt allowance for a touched query chain", async () => {
  const baselineSource = `async function load(client) {
  return client.from("ops_tasks").select("*").limit(30).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`
  const baseDebt = inspectQuerySurfaceSource({
    surface: "tasks",
    file: "src/features/tasks/list-tasks.ts",
    source: baselineSource,
  }).find((violation) => violation.reason === "list_select_star")
  const makeManifest = (baseSha) => [{
    surface: "tasks",
    file: "src/features/tasks/list-tasks.ts",
    symbol: "load",
    violation: "list_select_star",
    baselineSha: baseSha,
    fingerprint: baseDebt.fingerprint,
  }]
  const candidate = baselineSource.replace("retry(false)", "retry(false) // touched")

  assert.deepEqual(await verifyFixture({ baselineSource, source: candidate, debtManifest: makeManifest }), { ok: true, violations: [] })
  assert.deepEqual((await verifyFixture({ baselineSource, source: candidate, debtManifest: [] })).violations, [{
    file: "src/features/tasks/list-tasks.ts",
    symbol: "load",
    surface: "tasks",
    reason: "list_select_star",
  }])
})

test("an unmanifested legacy finding fails when its query chain is touched", async () => {
  const baselineSource = `async function load(client) {
  return client.from("ops_tasks").select("*").limit(30).order("id").abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`
  const result = await verifyFixture({
    baselineSource,
    source: baselineSource.replace("retry(false)", "retry(false) // touched"),
  })

  assert.deepEqual(result.violations, [{
    file: "src/features/tasks/list-tasks.ts",
    symbol: "load",
    surface: "tasks",
    reason: "list_select_star",
  }])
})

test("list contracts require an exact timeout call, deterministic order, and exact-key detail predicate", async () => {
  const result = await verifyFixture({
    source: `async function load(client, id, fallbackSignal) {
  await client.from("ops_tasks").select("id").limit(30).order("id").abortSignal(fallbackSignal || AbortSignal.timeout(8_000)).retry(false)
  await client.from("ops_tasks").select("id").single().abortSignal(AbortSignal.timeout(8000)).retry(false)
  return client.from("ops_tasks").select("id").limit(30).abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`,
  })

  assert.deepEqual(result.violations, [
    { file: "src/features/tasks/list-tasks.ts", symbol: "load", surface: "tasks", reason: "list_abort_signal_missing" },
    { file: "src/features/tasks/list-tasks.ts", symbol: "load", surface: "tasks", reason: "list_detail_predicate_missing" },
    { file: "src/features/tasks/list-tasks.ts", symbol: "load", surface: "tasks", reason: "list_limit_missing" },
    { file: "src/features/tasks/list-tasks.ts", symbol: "load", surface: "tasks", reason: "list_order_missing" },
    { file: "src/features/tasks/list-tasks.ts", symbol: "load", surface: "tasks", reason: "list_order_missing" },
  ])
})

test("ordered exact-key details and nested projections without wildcards remain allowed", async () => {
  const result = await verifyFixture({
    source: `async function load(client, id) {
  await client.from("ops_tasks").select("id, owner:profiles(id, name)").eq("id", id).single().abortSignal(AbortSignal.timeout(8000)).retry(false)
  return client.from("ops_tasks").select("id, owner:profiles(*)").limit(30).order("id").abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`,
  })

  assert.deepEqual(result.violations, [{
    file: "src/features/tasks/list-tasks.ts",
    symbol: "load",
    surface: "tasks",
    reason: "list_select_star",
  }])
})

test("deletion-only query-control diffs recheck every chain in the affected function", async () => {
  const baselineSource = `async function load(client) {
  return client.from("ops_tasks")
    .select("id")
    .limit(30)
    .order("id")
    .abortSignal(AbortSignal.timeout(8000))
    .retry(false)
}
`
  const cases = [
    ["    .limit(30)\n", "list_limit_missing"],
    ["    .order(\"id\")\n", "list_order_missing"],
    ["    .abortSignal(AbortSignal.timeout(8000))\n", "list_abort_signal_missing"],
    ["    .retry(false)\n", "list_retry_false_missing"],
  ]
  for (const [removedControl, reason] of cases) {
    const result = await verifyFixture({ baselineSource, source: baselineSource.replace(removedControl, "") })
    assert.ok(result.violations.some((violation) => violation.reason === reason), `expected ${reason} after deleting ${removedControl}`)
  }
})

test("constant dependency changes recheck every chain in the affected function", async () => {
  const baselineSource = `async function load(client) {
  const projection = "id"
  const pageSize = 30
  return client.from("ops_tasks").select(projection).limit(pageSize).order("id").abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`
  const projection = await verifyFixture({ baselineSource, source: baselineSource.replace('"id"', '"*"') })
  assert.ok(projection.violations.some((violation) => violation.reason === "list_select_star"))
  const pageSize = await verifyFixture({ baselineSource, source: baselineSource.replace("pageSize = 30", "pageSize = 31") })
  assert.ok(pageSize.violations.some((violation) => violation.reason === "list_limit_exceeds_30"))
})

test("root list controls do not accept foreign-table controls and require an id tie break", async () => {
  const result = await verifyFixture({
    source: `async function load(client) {
  return client.from("ops_tasks").select("id").limit(30, { foreignTable: "children" }).order("created_at", { referencedTable: "children" }).abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`,
  })

  assert.deepEqual(result.violations, [
    { file: "src/features/tasks/list-tasks.ts", symbol: "load", surface: "tasks", reason: "list_limit_missing" },
    { file: "src/features/tasks/list-tasks.ts", symbol: "load", surface: "tasks", reason: "list_order_missing" },
  ])

  const unorderedTieBreak = await verifyFixture({
    source: `async function load(client) {
  return client.from("ops_tasks").select("id").limit(30).order("created_at").abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`,
  })
  assert.deepEqual(unorderedTieBreak.violations, [{
    file: "src/features/tasks/list-tasks.ts", symbol: "load", surface: "tasks", reason: "list_order_tie_break_missing",
  }])
})

test("detail predicates and effective final abort and retry controls are fail-closed", async () => {
  const result = await verifyFixture({
    source: `async function load(client, otherSignal) {
  return client.from("ops_tasks").select("id").eq("id", undefined).single().abortSignal(AbortSignal.timeout(8000)).abortSignal(otherSignal).retry(false).retry(true)
}
`,
  })

  assert.deepEqual(result.violations, [
    { file: "src/features/tasks/list-tasks.ts", symbol: "load", surface: "tasks", reason: "list_abort_signal_missing" },
    { file: "src/features/tasks/list-tasks.ts", symbol: "load", surface: "tasks", reason: "list_detail_predicate_missing" },
    { file: "src/features/tasks/list-tasks.ts", symbol: "load", surface: "tasks", reason: "list_limit_missing" },
    { file: "src/features/tasks/list-tasks.ts", symbol: "load", surface: "tasks", reason: "list_order_missing" },
    { file: "src/features/tasks/list-tasks.ts", symbol: "load", surface: "tasks", reason: "list_retry_false_missing" },
  ])
})

test("a stale manifest fingerprint cannot grandfather a reintroduced query debt", async () => {
  const file = "src/features/tasks/list-tasks.ts"
  const original = `async function load(client) {
  return client.from("ops_tasks").select("*").limit(30).order("id").abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`
  const fixed = original.replace('select("*")', 'select("id")')
  const root = await createFixtureRepository({ [file]: original })
  try {
    const historicalSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
    const fingerprint = inspectQuerySurfaceSource({ surface: "tasks", file, source: original }).find((violation) => violation.reason === "list_select_star").fingerprint
    await writeFile(join(root, file), fixed)
    const baseSha = commitFixture(root)
    await writeFile(join(root, file), original)
    const headSha = commitFixture(root)
    const result = await verifyQuerySurfaceBudget({
      surface: "tasks",
      baseSha,
      headSha,
      root,
      debtManifest: [{ surface: "tasks", file, symbol: "load", violation: "list_select_star", baselineSha: historicalSha, fingerprint }],
    })
    assert.deepEqual(result.violations, [{ file, symbol: "load", surface: "tasks", reason: "list_select_star" }])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("root controls fail closed for spread, shorthand, and aliased relation options", async () => {
  const result = await verifyFixture({
    source: `async function load(client, foreignTable) {
  const relation = { foreignTable: "children" }
  return client.from("ops_tasks").select("id").limit(30, relation).order("id", { foreignTable }).abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`,
  })

  assert.ok(result.violations.some((violation) => violation.reason === "list_limit_missing"))
  assert.ok(result.violations.some((violation) => violation.reason === "list_order_missing"))

  const spread = await verifyFixture({
    source: `async function load(client, options) {
  return client.from("ops_tasks").select("id").limit(30, { ...options }).order("id", { ...options }).abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`,
  })
  assert.ok(spread.violations.some((violation) => violation.reason === "list_limit_missing"))
  assert.ok(spread.violations.some((violation) => violation.reason === "list_order_missing"))
})

test("shared query builders create separate immutable request branches", async () => {
  const result = await verifyFixture({
    source: `async function load(client) {
  const builder = client.from("ops_tasks").select("id")
  const safe = builder.limit(30).order("id").abortSignal(AbortSignal.timeout(8000)).retry(false)
  return builder.abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`,
  })

  assert.ok(result.violations.some((violation) => violation.reason === "list_limit_missing"))
  assert.ok(result.violations.some((violation) => violation.reason === "list_order_missing"))
})

test("mutable constants and RPC argument spreads are unresolved", async () => {
  const list = await verifyFixture({
    source: `async function load(client) {
  let projection = "id"
  let pageSize = 30
  projection = "*"
  return client.from("ops_tasks").select(projection).limit(pageSize).order("id").abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`,
  })
  assert.ok(list.violations.some((violation) => violation.reason === "list_projection_unresolved"))
  assert.ok(list.violations.some((violation) => violation.reason === "list_limit_unresolved"))

  const rpc = await verifyFixture({
    source: `async function load(client, page) {
  return client.rpc("list_ops_task_page_v1", { ...page, p_limit: 30 }).abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`,
  })
  assert.ok(rpc.violations.some((violation) => violation.reason === "rpc_page_limit_unresolved"))
})

test("task fan-out rejects any nonliteral task_id membership list", async () => {
  const result = await verifyFixture({
    source: `async function load(client, ids) {
  return client.from("ops_task_comments").select("id").in("task_id", ids).limit(30).order("id").abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`,
  })
  assert.ok(result.violations.some((violation) => violation.reason === "task_id_batch_in_list"))
})

test("detail requests reject void and statically invalid id values", async () => {
  const result = await verifyFixture({
    source: `async function load(client) {
  return client.from("ops_tasks").select("id").eq("id", void 0).single().abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`,
  })
  assert.ok(result.violations.some((violation) => violation.reason === "list_detail_predicate_missing"))
})

test("conditional builder writes fail closed instead of lending controls to the final query", async () => {
  const result = await verifyFixture({
    source: `async function load(client, enabled) {
  let query = client.from("ops_tasks").select("id")
  if (enabled) query = query.limit(30).order("id")
  return query.abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`,
  })
  assert.ok(result.violations.some((violation) => violation.reason === "list_query_control_flow_unresolved"))
})

test("shadowed bindings and object property mutations are unresolved", async () => {
  const shadow = await verifyFixture({
    source: `async function load(client) {
  const projection = "*"
  { const projection = "id" }
  return client.from("ops_tasks").select(projection).limit(30).order("id").abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`,
  })
  assert.ok(shadow.violations.some((violation) => violation.reason === "list_select_star"))

  const mutation = await verifyFixture({
    source: `async function load(client) {
  const options = {}
  options.foreignTable = "children"
  return client.from("ops_tasks").select("id").limit(30, options).order("id").abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`,
  })
  assert.ok(mutation.violations.some((violation) => violation.reason === "list_limit_missing"))
})

test("bound Supabase from and rpc aliases remain inspected query entry points", async () => {
  const result = await verifyFixture({
    source: `async function load(client) {
  const from = client.from.bind(client)
  const rpc = client.rpc.bind(client)
  await from("ops_tasks").select("*").limit(30).order("id").abortSignal(AbortSignal.timeout(8000)).retry(false)
  return rpc("list_ops_task_page_v1", {}).abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`,
  })
  assert.ok(result.violations.some((violation) => violation.reason === "list_select_star"))
  assert.ok(result.violations.some((violation) => violation.reason === "rpc_page_limit_missing"))
})

test("task_id membership rejects literal arrays while exact task_id details remain allowed", async () => {
  const list = await verifyFixture({
    source: `async function load(client) {
  return client.from("ops_task_comments").select("id").in("task_id", ["task-1"]).limit(30).order("id").abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`,
  })
  assert.ok(list.violations.some((violation) => violation.reason === "task_id_batch_in_list"))

  const detail = await verifyFixture({
    source: `async function load(client, taskId) {
  return client.from("ops_task_comments").select("id").eq("task_id", taskId).single().abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`,
  })
  assert.deepEqual(detail, { ok: true, violations: [] })
})

test("query builder aliases preserve unsafe branch mutations", async () => {
  const result = await verifyFixture({
    source: `async function load(client) {
  const query = client.from("ops_tasks").select("id")
  const unsafe = query
  return unsafe.select("*").limit(100).order("id").abortSignal(AbortSignal.timeout(8000)).retry(true)
}
`,
  })
  assert.ok(result.violations.some((violation) => violation.reason === "list_select_star"))
  assert.ok(result.violations.some((violation) => violation.reason === "list_limit_exceeds_30"))
  assert.ok(result.violations.some((violation) => violation.reason === "list_retry_false_missing"))
})

test("bound query entry aliases remain known after alias assignment", async () => {
  const result = await verifyFixture({
    source: `async function load(client) {
  const from = client.from.bind(client)
  const run = from
  return run("ops_tasks").select("*").limit(30).order("id").abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`,
  })
  assert.ok(result.violations.some((violation) => violation.reason === "list_select_star"))
})

test("task in columns resolve constants and bound operations fail closed when unknown", async () => {
  const computed = await verifyFixture({
    source: `async function load(client) {
  const column = "task_id"
  return client.from("ops_task_comments").select("id").in(column, []).limit(30).order("id").abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`,
  })
  assert.ok(computed.violations.some((violation) => violation.reason === "task_id_batch_in_list"))

  const bound = await verifyFixture({
    source: `async function load(client) {
  const query = client.from("ops_task_comments").select("id")
  const filter = query.in.bind(query)
  return filter(getColumn(), []).limit(30).order("id").abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`,
  })
  assert.ok(bound.violations.some((violation) => violation.reason === "task_in_column_unresolved"))
})

test("bound operation aliases propagate through immutable assignments", async () => {
  const result = await verifyFixture({
    source: `async function load(client) {
  const query = client.from("ops_task_comments").select("id")
  const filter = query.in.bind(query)
  const run = filter
  return run("task_id", []).limit(30).order("id").abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`,
  })
  assert.ok(result.violations.some((violation) => violation.reason === "task_id_batch_in_list"))
})
