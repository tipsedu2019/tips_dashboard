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
  return client.from("ops_tasks").select("*").limit(30).abortSignal(AbortSignal.timeout(8_000)).retry(false)
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
  return client.from("ops_tasks").select("id").limit(31).abortSignal(AbortSignal.timeout(8_000)).retry(false)
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
  return client.from("ops_tasks").select(columns).limit(pageSize).abortSignal(AbortSignal.timeout(8_000)).retry(false)
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
  return client.from(table).select(projection).limit(30).abortSignal(AbortSignal.timeout(8_000)).retry(false)
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
  return client.from(table).select("id").limit(pageSize).abortSignal(AbortSignal.timeout(8_000)).retry(false)
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
  return client["from"](table).select("id").limit(30).abortSignal(AbortSignal.timeout(8_000)).retry(false)
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
  await client.from(table).select("*").limit(30).abortSignal(AbortSignal.timeout(8_000)).retry(false)
  return []
}
`
  const result = await verifyFixture({
    surface: "management",
    file: "src/features/management/management-service.js",
    baselineSource,
    source: `async function selectRows(client, table) {
  await client.from(table).select("*").limit(30).abortSignal(AbortSignal.timeout(8_000)).retry(false)
  return client.from(table).select("*").limit(30).abortSignal(AbortSignal.timeout(8_000)).retry(false)
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

test("query budget debt exception binds an exact baseline chain instead of a current same-code count", async () => {
  const baselineSource = `async function selectRows(client, table) {
  return client.from(table).select("*").limit(30).abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`
  const result = await verifyFixture({
    surface: "management",
    file: "src/features/management/management-service.js",
    baselineSource,
    source: `async function selectRows(client, table) {
  const projection = "id"
  await client.from(table).select(projection).limit(30).abortSignal(AbortSignal.timeout(8_000)).retry(false)
  return client.from(table).select("*").limit(30).abortSignal(AbortSignal.timeout(8_000)).retry(false)
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

test("all direct owned-surface query chains are inspected even without a list marker", async () => {
  const result = await verifyFixture({
    source: `async function opaque(client) {
  return client.from("ops_tasks").select("*").abortSignal(AbortSignal.timeout(8_000)).retry(false)
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
  await client.from("ops_tasks").select("id").limit(30).abortSignal(AbortSignal.timeout(8_000)).retry(false)
  return client.from("ops_tasks").select("id").limit(30).abortSignal(AbortSignal.timeout(8_000))
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
    source: `client.from("ops_tasks").select("id").limit(30).abortSignal(AbortSignal.timeout(8_000)).retry(false)
export const loadRows = async client => client.from("ops_tasks").select("*").abortSignal(AbortSignal.timeout(8_000)).retry(false)
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
  return client?.[method]?.("ops_tasks").select("id").limit(30).abortSignal(AbortSignal.timeout(8_000)).retry(false)
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
  return client.from(table).select("*").abortSignal(AbortSignal.timeout(8_000)).retry(false)
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
  return client?.[method]?.(table).select("id").limit(30).abortSignal(AbortSignal.timeout(8_000)).retry(false)
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
  return client.from(table).select(projection).limit(pageSize).abortSignal(AbortSignal.timeout(8_000)).retry(false)
}
`,
  })

  assert.deepEqual(result, { ok: true, violations: [] })
})

test("single-row and bounded range query chains are explicit list-limit exemptions", async () => {
  const result = await verifyFixture({
    source: `async function readRows(client) {
  await client.from("ops_tasks").select("id").single().abortSignal(AbortSignal.timeout(8_000)).retry(false)
  return client.from("ops_tasks").select("id").range(0, 29).abortSignal(AbortSignal.timeout(8_000)).retry(false)
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

test("query budget rejects wildcard fields with whitespace or mixed projections", async () => {
  const result = await verifyFixture({
    source: `async function readRows(client) {
  await client.from("ops_tasks").select(" *, name ").limit(30).abortSignal(AbortSignal.timeout(8_000)).retry(false)
  return client.from("ops_tasks").select("id, *").limit(30).abortSignal(AbortSignal.timeout(8_000)).retry(false)
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
  return client.from("ops_tasks").select("id").limit(30)
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
  return client.from("ops_task_comments").select("id").in("task_id", taskIds).limit(30).abortSignal(AbortSignal.timeout(8_000)).retry(false)
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
  return client.from("ops_tasks").select("*").limit(30).abortSignal(AbortSignal.timeout(8_000)).retry(false)
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
