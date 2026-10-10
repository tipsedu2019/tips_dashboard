import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { inspectQuerySurfaceSource, verifyQuerySurfaceBudget } from "../src/lib/query-surface-budget.js"

const FILE = "src/features/tasks/imported-query-fixture.ts"
const DEPENDENCY = "src/lib/imported-query-contract.ts"
const SPECIFIER = "../../lib/imported-query-contract.ts"
const PROJECTION = "id,title,type,status,priority,student_name,campus,subject,created_at,updated_at,requested_team"
const CONTROLLED_CHAIN = 'client.from("ops_tasks").select(COLUMNS).limit(30).order("id").abortSignal(AbortSignal.timeout(8000)).retry(false)'
const CONSUMER = `import { COLUMNS } from "${SPECIFIER}"\nexport async function listRows(client) { return ${CONTROLLED_CHAIN} }\n`

function inspect({ source = CONSUMER, exporter = `export const COLUMNS = ${JSON.stringify(PROJECTION)}\n`, importSources = new Map([[DEPENDENCY, exporter]]) } = {}) {
  return inspectQuerySurfaceSource({ surface: "tasks", file: FILE, source, importSources })
}
function reasons(options) { return inspect(options).map((violation) => violation.reason) }
function unresolved(options) { assert.ok(reasons(options).includes("list_projection_unresolved")) }

test("a real named import proves an explicit eleven-column list projection", () => {
  assert.equal(PROJECTION.split(",").length, 11)
  assert.deepEqual(inspect(), [])
})
test("named import aliases prove string projections and literal numeric page and deadline budgets", () => {
  const source = `import { COLUMNS as SELECT_COLUMNS, PAGE_LIMIT as CAP, DEADLINE_MS as DEADLINE } from "${SPECIFIER}"
export async function listRows(client) {
  return client.from("ops_tasks").select(SELECT_COLUMNS).limit(CAP).order("id").abortSignal(AbortSignal.timeout(DEADLINE)).retry(false)
}`
  const exporter = `export const COLUMNS = ${JSON.stringify(PROJECTION)}
export const PAGE_LIMIT = 30
export const DEADLINE_MS = 8000
`
  assert.deepEqual(inspect({ source, exporter }), [])
})
test("local immutable aliases retain the actual imported constant identity", () => {
  const source = `import { COLUMNS as SELECT_COLUMNS } from "${SPECIFIER}"
export async function listRows(client) {
  const LOCAL_COLUMNS = SELECT_COLUMNS
  return client.from("ops_tasks").select(LOCAL_COLUMNS).limit(30).order("id").abortSignal(AbortSignal.timeout(8000)).retry(false)
}`
  assert.deepEqual(inspect({ source }), [])
})
test("an imported wildcard remains a list-select-star violation instead of an exemption", () => {
  assert.deepEqual(reasons({ exporter: 'export const COLUMNS = "*"\n' }), ["list_select_star"])
  assert.deepEqual(reasons({ exporter: 'export const COLUMNS = "id,children(*)"\n' }), ["list_select_star"])
})
test("imported numeric constants cannot weaken page or deadline budgets", () => {
  const source = `import { COLUMNS, PAGE_LIMIT, DEADLINE_MS } from "${SPECIFIER}"
export async function listRows(client) { return client.from("ops_tasks").select(COLUMNS).limit(PAGE_LIMIT).order("id").abortSignal(AbortSignal.timeout(DEADLINE_MS)).retry(false) }`
  const prefix = `export const COLUMNS = ${JSON.stringify(PROJECTION)}\n`
  assert.ok(reasons({ source, exporter: prefix + "export const PAGE_LIMIT = 31\nexport const DEADLINE_MS = 8000\n" }).includes("list_limit_exceeds_30"))
  assert.ok(reasons({ source, exporter: prefix + "export const PAGE_LIMIT = 30\nexport const DEADLINE_MS = 8001\n" }).includes("list_abort_signal_missing"))
})
test("mutable, shadowed and written numeric imports cannot prove a timeout budget", () => {
  const imports = `import { COLUMNS, DEADLINE_MS } from "${SPECIFIER}"\n`
  const chain = CONTROLLED_CHAIN.replace("timeout(8000)", "timeout(DEADLINE_MS)")
  const exporter = `export const COLUMNS = ${JSON.stringify(PROJECTION)}\nexport const DEADLINE_MS = 8000\n`
  for (const source of [
    `${imports}export async function listRows(client, DEADLINE_MS) { return ${chain} }`,
    `${imports}export async function listRows(client) { { const DEADLINE_MS = getRuntimeDeadline(); return ${chain} } }`,
    `${imports}DEADLINE_MS = 8000\nexport async function listRows(client) { return ${chain} }`,
  ]) assert.deepEqual(reasons({ source, exporter }), ["list_abort_signal_missing"])
  assert.deepEqual(reasons({
    source: `${imports}export async function listRows(client) { return ${chain} }`,
    exporter: exporter.replace("export const DEADLINE_MS", "export let DEADLINE_MS"),
  }), ["list_abort_signal_missing"])
})
test("mutable, runtime-computed, nonexported and dynamic exporter values provide no projection proof", () => {
  for (const exporter of [
    'export let COLUMNS = "id"',
    'export var COLUMNS = "id"',
    'const COLUMNS = "id"',
    'export function COLUMNS() { return "id" }',
    'export const COLUMNS = getRuntimeColumns()',
    'export const COLUMNS = process.env.RUNTIME_COLUMNS',
    'export const COLUMNS = "id" + ",title"',
    'export const COLUMNS = `${runtimeColumns}`',
    'export const COLUMNS = { projection: "id" }',
  ]) unresolved({ exporter })
})
test("reexport statements and nested exports are not top-level literal exporter evidence", () => {
  for (const exporter of [
    'export { COLUMNS } from "./another-module.ts"',
    'export * from "./another-module.ts"',
    'const COLUMNS = "id"; export { COLUMNS }',
    'namespace Contract { export const COLUMNS = "id" }',
  ]) unresolved({ exporter })
})
test("type-only, default and namespace imports do not borrow named runtime binding evidence", () => {
  for (const declaration of [
    `import type { COLUMNS } from "${SPECIFIER}"`,
    `import { type COLUMNS } from "${SPECIFIER}"`,
    `import COLUMNS from "${SPECIFIER}"`,
    `import * as COLUMNS from "${SPECIFIER}"`,
  ]) unresolved({ source: `${declaration}\nexport async function listRows(client) { return ${CONTROLLED_CHAIN} }` })
})
test("a parameter shadow or runtime block binding cannot inherit an imported projection", () => {
  unresolved({ source: `import { COLUMNS } from "${SPECIFIER}"
export async function listRows(client, COLUMNS) { return ${CONTROLLED_CHAIN} }` })
  for (const binding of ["let COLUMNS = getRuntimeColumns()", "const COLUMNS = getRuntimeColumns()", "const COLUMNS = undefined"]) {
    unresolved({ source: `import { COLUMNS } from "${SPECIFIER}"
export async function listRows(client) { { ${binding}; return ${CONTROLLED_CHAIN} } }` })
  }
})
test("a literal wildcard shadow is diagnosed by its own value, never the import", () => {
  const source = `import { COLUMNS } from "${SPECIFIER}"
export async function listRows(client) { { const COLUMNS = "*"; return ${CONTROLLED_CHAIN} } }`
  assert.deepEqual(reasons({ source }), ["list_select_star"])
})
test("writes to imported or exported constants invalidate apparent literal proof", () => {
  for (const write of ['COLUMNS = "*"', 'COLUMNS += ",*"', '({ COLUMNS } = replacement)']) {
    unresolved({ source: `import { COLUMNS } from "${SPECIFIER}"
${write}
export async function listRows(client) { return ${CONTROLLED_CHAIN} }` })
  }
  unresolved({ exporter: 'export const COLUMNS = "id"\nfunction rewrite() { COLUMNS = "*" }' })
})
test("unresolved exports and wrong source-map paths cannot supply accidental evidence", () => {
  unresolved({ importSources: new Map() })
  unresolved({ exporter: 'export const OTHER_COLUMNS = "id"' })
  unresolved({ importSources: new Map([["src/lib/another-contract.ts", 'export const COLUMNS = "id"']]) })
  unresolved({ importSources: new Map([["../lib/imported-query-contract.ts", 'export const COLUMNS = "id"']]) })
})
test("outside-code and credential-looking imports are rejected without reading their source entries", () => {
  for (const specifier of ["../../../.env", "../../lib/.env", "../../../../outside.ts", "some-package", "../../lib/data.json"]) {
    const reads = []
    class ObservedMap extends Map { get(key) { reads.push(key); return super.get(key) } }
    const sources = new ObservedMap([[".env", 'export const COLUMNS = "id"'], ["../outside.ts", 'export const COLUMNS = "id"']])
    unresolved({ source: `import { COLUMNS } from ${JSON.stringify(specifier)}\nexport async function listRows(client) { return ${CONTROLLED_CHAIN} }`, importSources: sources })
    assert.deepEqual(reads, [], `source entries were read for ${specifier}`)
  }
})
test("ambient declarations do not assert an actual exported runtime value", () => {
  unresolved({ exporter: 'export declare const COLUMNS = "id"' })
})
test("declaration-file imports cannot establish executable exported values", () => {
  const reads = []
  class ObservedMap extends Map { get(key) { reads.push(key); return super.get(key) } }
  unresolved({
    source: `import { COLUMNS } from "../../lib/imported-query-contract.d.ts"\nexport async function listRows(client) { return ${CONTROLLED_CHAIN} }`,
    importSources: new ObservedMap([["src/lib/imported-query-contract.d.ts", 'export const COLUMNS = "id"']]),
  })
  assert.deepEqual(reads, [])
})

function git(root, args, preserveBytes = false) {
  const result = execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  return preserveBytes ? result : result.trim()
}
async function put(root, file, contents) {
  const path = join(root, file)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents)
}
async function repository({ consumer = CONSUMER, exporter = '\n// synthetic source fixture\nexport const COLUMNS = "id"\n\n' } = {}) {
  const root = await mkdtemp(join(tmpdir(), "query-imported-constant-fixture-"))
  await put(root, FILE, consumer)
  await put(root, DEPENDENCY, exporter)
  git(root, ["init", "--quiet"])
  git(root, ["config", "user.email", "query-import-fixture@example.invalid"])
  git(root, ["config", "user.name", "Imported constant fixture"])
  git(root, ["add", "."])
  git(root, ["commit", "--quiet", "-m", "baseline"])
  return { root, baseSha: git(root, ["rev-parse", "HEAD"]) }
}
function commit(root) {
  git(root, ["add", "."])
  git(root, ["commit", "--quiet", "-m", "dependency-only candidate"])
  return git(root, ["rev-parse", "HEAD"])
}
function expectConsumerWildcard(result) {
  assert.equal(result.ok, false)
  assert.deepEqual(result.violations, [{ file: FILE, symbol: "listRows", surface: "tasks", reason: "list_select_star" }])
}

test("dependency-only worktree edits force an unchanged query consumer to be rechecked", async () => {
  const { root, baseSha } = await repository()
  try {
    const originalConsumer = await readFile(join(root, FILE), "utf8")
    await put(root, DEPENDENCY, '\n// synthetic source fixture\nexport const COLUMNS = "*"\n\n')
    assert.equal(await readFile(join(root, FILE), "utf8"), originalConsumer)
    expectConsumerWildcard(await verifyQuerySurfaceBudget({ surface: "tasks", baseSha, includeWorktree: true, root, debtManifest: [] }))
  } finally { await rm(root, { recursive: true, force: true }) }
})
test("losing a literal export forces an unchanged consumer to fail closed", async () => {
  for (const exporter of ['export let COLUMNS = "id"\n', 'export const OTHER_COLUMNS = "id"\n']) {
    const { root, baseSha } = await repository()
    try {
      const originalConsumer = await readFile(join(root, FILE), "utf8")
      await put(root, DEPENDENCY, exporter)
      assert.equal(await readFile(join(root, FILE), "utf8"), originalConsumer)
      const result = await verifyQuerySurfaceBudget({ surface: "tasks", baseSha, includeWorktree: true, root, debtManifest: [] })
      assert.equal(result.ok, false)
      assert.deepEqual(result.violations, [{ file: FILE, symbol: "listRows", surface: "tasks", reason: "list_projection_unresolved" }])
    } finally { await rm(root, { recursive: true, force: true }) }
  }
})
test("function-only dependency edits do not force unrelated unchanged query debt to be rechecked", async () => {
  const consumer = `import { formatLabel } from "${SPECIFIER}"\nexport async function listRows(client) { formatLabel("synthetic"); return ${CONTROLLED_CHAIN.replace("select(COLUMNS)", 'select("*")')} }\n`
  const { root, baseSha } = await repository({ consumer, exporter: 'export function formatLabel(value) { return value }\n' })
  try {
    await put(root, DEPENDENCY, 'export function formatLabel(value) { return String(value) }\n')
    assert.equal(await readFile(join(root, FILE), "utf8"), consumer)
    assert.deepEqual(await verifyQuerySurfaceBudget({ surface: "tasks", baseSha, includeWorktree: true, root, debtManifest: [] }), { ok: true, violations: [] })
  } finally { await rm(root, { recursive: true, force: true }) }
})
test("dependency-only HEAD verification reads candidate blob bytes instead of a safer dirty worktree", async () => {
  const { root, baseSha } = await repository()
  try {
    const candidateBytes = '\n// candidate exporter bytes\nexport const COLUMNS = "*"\n\n'
    await put(root, DEPENDENCY, candidateBytes)
    const headSha = commit(root)
    assert.equal(git(root, ["show", `${headSha}:${DEPENDENCY}`], true), candidateBytes)
    assert.equal(git(root, ["show", `${headSha}:${FILE}`], true), git(root, ["show", `${baseSha}:${FILE}`], true))
    await put(root, DEPENDENCY, 'export const COLUMNS = "id"\n')
    expectConsumerWildcard(await verifyQuerySurfaceBudget({ surface: "tasks", baseSha, headSha, root, debtManifest: [] }))
    assert.deepEqual(await verifyQuerySurfaceBudget({ surface: "tasks", baseSha, includeWorktree: true, root, debtManifest: [] }), { ok: true, violations: [] })
  } finally { await rm(root, { recursive: true, force: true }) }
})
test("a committed safe dependency cannot hide a later wildcard worktree edit", async () => {
  const { root, baseSha } = await repository()
  try {
    await put(root, DEPENDENCY, `\nexport const COLUMNS = ${JSON.stringify(PROJECTION)}\n\n`)
    const headSha = commit(root)
    await put(root, DEPENDENCY, 'export const COLUMNS = "*"\n')
    assert.deepEqual(await verifyQuerySurfaceBudget({ surface: "tasks", baseSha, headSha, root, debtManifest: [] }), { ok: true, violations: [] })
    expectConsumerWildcard(await verifyQuerySurfaceBudget({ surface: "tasks", baseSha, includeWorktree: true, root, debtManifest: [] }))
  } finally { await rm(root, { recursive: true, force: true }) }
})

const CAUSAL_EXPORTER = 'export const COLUMNS = "id"\nexport const PAGE_LIMIT = 30\nexport const DEADLINE_MS = 8000\n'
const CAUSAL_CHAIN = 'client.from("ops_tasks").select(LOCAL_COLUMNS).limit(LOCAL_CAP).order("id").abortSignal(AbortSignal.timeout(LOCAL_DEADLINE)).retry(false)'
const UNRELATED_LEGACY_CHAIN = 'client.from("ops_tasks").select("*")'

function causalConsumer(layout) {
  const prefix = `import { COLUMNS as SELECT_COLUMNS, PAGE_LIMIT as CAP, DEADLINE_MS as DEADLINE } from "${SPECIFIER}"
export async function listRows(client) {
  const LOCAL_COLUMNS = SELECT_COLUMNS
  const LOCAL_CAP = CAP
  const LOCAL_DEADLINE = DEADLINE
`
  return layout === "same function"
    ? prefix + `  const importedRows = await ${CAUSAL_CHAIN}
  const legacyRows = await ${UNRELATED_LEGACY_CHAIN}
  return { importedRows, legacyRows }
}\n`
    : prefix + `  return ${CAUSAL_CHAIN}
}
export async function unrelatedLegacy(client) { return ${UNRELATED_LEGACY_CHAIN} }\n`
}

const CAUSAL_MUTATIONS = [
  ["wildcard projection", CAUSAL_EXPORTER.replace('COLUMNS = "id"', 'COLUMNS = "*"'), ["list_select_star"]],
  ["mutable export", CAUSAL_EXPORTER.replace("export const COLUMNS", "export let COLUMNS"), ["list_projection_unresolved"]],
  ["deleted export", CAUSAL_EXPORTER.replace('export const COLUMNS = "id"\n', ""), ["list_projection_unresolved"]],
  ["deleted dependency", null, ["list_abort_signal_missing", "list_limit_unresolved", "list_projection_unresolved"]],
  ["oversized page", CAUSAL_EXPORTER.replace("PAGE_LIMIT = 30", "PAGE_LIMIT = 31"), ["list_limit_exceeds_30"]],
  ["longer deadline", CAUSAL_EXPORTER.replace("DEADLINE_MS = 8000", "DEADLINE_MS = 8001"), ["list_abort_signal_missing"]],
]

for (const layout of ["separate function", "same function"]) {
  test("dependency-only changes recheck only the imported chain with legacy debt in the " + layout, async () => {
    const consumer = causalConsumer(layout)
    // Both layouts contain an actual failing legacy chain. It must not be
    // forced merely because another query in this file reads the dependency.
    const legacyDiagnostics = inspectQuerySurfaceSource({
      surface: "tasks", file: FILE, source: consumer,
      importSources: new Map([[DEPENDENCY, CAUSAL_EXPORTER]]),
    })
    assert.ok(legacyDiagnostics.some(violation => violation.reason === "list_select_star"))
    assert.ok(legacyDiagnostics.some(violation => violation.reason === "list_limit_missing"))
    for (const [label, exporter, expectedReasons] of CAUSAL_MUTATIONS) {
      const { root, baseSha } = await repository({ consumer, exporter: CAUSAL_EXPORTER })
      try {
        if (exporter === null) await rm(join(root, DEPENDENCY))
        else await put(root, DEPENDENCY, exporter)
        assert.equal(await readFile(join(root, FILE), "utf8"), consumer)
        assert.deepEqual(git(root, ["diff", "--name-only"]).split("\n"), [DEPENDENCY])
        const expected = expectedReasons.map(reason => ({ file: FILE, symbol: "listRows", surface: "tasks", reason }))
        const worktree = await verifyQuerySurfaceBudget({ surface: "tasks", baseSha, includeWorktree: true, root, debtManifest: [] })
        assert.equal(worktree.ok, false, label)
        assert.deepEqual(worktree.violations, expected, layout + ": " + label + " worktree")
        const headSha = commit(root)
        const committed = await verifyQuerySurfaceBudget({ surface: "tasks", baseSha, headSha, root, debtManifest: [] })
        assert.equal(committed.ok, false, label)
        assert.deepEqual(committed.violations, expected, layout + ": " + label + " HEAD")
      } finally { await rm(root, { recursive: true, force: true }) }
    }
  })
}

test("shadowed imported constants do not force an unchanged consumer's legacy query", async () => {
  const imports = `import { COLUMNS } from "${SPECIFIER}"\n`
  for (const consumer of [
    imports + `export async function listRows(client, COLUMNS) { return ${CONTROLLED_CHAIN} }\n`,
    imports + `export async function listRows(client) { { const COLUMNS = getRuntimeColumns(); return ${CONTROLLED_CHAIN} } }\n`,
    imports + `export async function listRows(client) { { const COLUMNS = "*"; return ${CONTROLLED_CHAIN} } }\n`,
  ]) {
    const directDiagnostics = inspectQuerySurfaceSource({
      surface: "tasks", file: FILE, source: consumer,
      importSources: new Map([[DEPENDENCY, 'export const COLUMNS = "*"\n']]),
      changedImportNames: new Set(["COLUMNS"]),
    })
    assert.ok(directDiagnostics.length > 0, "the shadowed query has genuine unchanged legacy debt")
    assert.ok(directDiagnostics.every(violation => !violation.importedDependencyAffected))
    const { root, baseSha } = await repository({ consumer })
    try {
      await put(root, DEPENDENCY, 'export const COLUMNS = "*"\n')
      assert.equal(await readFile(join(root, FILE), "utf8"), consumer)
      assert.deepEqual(git(root, ["diff", "--name-only"]).split("\n"), [DEPENDENCY])
      assert.deepEqual(await verifyQuerySurfaceBudget({ surface: "tasks", baseSha, includeWorktree: true, root, debtManifest: [] }),
        { ok: true, violations: [] })
      const headSha = commit(root)
      assert.deepEqual(await verifyQuerySurfaceBudget({ surface: "tasks", baseSha, headSha, root, debtManifest: [] }),
        { ok: true, violations: [] })
    } finally { await rm(root, { recursive: true, force: true }) }
  }
})

test("per-chain dependency metadata preserves hidden legacy occurrence evidence", () => {
  const source = causalConsumer("same function")
  const diagnostics = inspectQuerySurfaceSource({
    surface: "tasks", file: FILE, source,
    importSources: new Map([[DEPENDENCY, CAUSAL_EXPORTER.replace('COLUMNS = "id"', 'COLUMNS = "*"')]]),
    changedImportNames: new Set(["SELECT_COLUMNS", "CAP", "DEADLINE"]),
  })
  assert.ok(diagnostics.some(violation => violation.importedDependencyAffected === true))
  assert.ok(diagnostics.some(violation => !violation.importedDependencyAffected))
  for (const violation of diagnostics) {
    assert.match(violation.occurrenceFingerprint, /^[0-9a-f]{64}$/u)
    assert.equal(typeof violation.occurrenceContext.query, "string")
    assert.equal(Object.getOwnPropertyDescriptor(violation, "occurrenceFingerprint").enumerable, false)
    assert.equal(Object.getOwnPropertyDescriptor(violation, "occurrenceContext").enumerable, false)
    const affected = Object.getOwnPropertyDescriptor(violation, "importedDependencyAffected")
    if (affected) {
      assert.equal(affected.value, true)
      assert.equal(affected.enumerable, false)
    } else assert.equal(violation.importedDependencyAffected, undefined)
  }
})
