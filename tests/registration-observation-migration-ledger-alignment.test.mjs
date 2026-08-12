const EXPECTED_PENDING = Object.freeze([
  "20260809100000",
  "20260809101000",
  "20260809102000",
  "20260809102200",
  "20260809102400",
  "20260809102450",
  "20260809102500",
  "20260809103000",
  "20260809103500",
  "20260809104000",
  "20260809104500",
  "20260809105000",
  "20260809106000",
  "20260809106100",
  "20260809106200",
  "20260812002019",
  "20260812003000",
])

import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const solapiPlanPath = join(
  repoRoot,
  "docs/superpowers/plans/2026-08-09-registration-observation-solapi.md",
)
const masterPlanPath = join(
  repoRoot,
  "docs/superpowers/plans/2026-08-09-registration-observation-workflow.md",
)
const obsoleteVersions = Object.freeze([
  "20260807025103",
  "20260807110530",
  "20260807125500",
  "20260808043659",
  "20260808051000",
  "20260808120425",
])

function versions(source) {
  return [...source.matchAll(/\b(\d{14})\b/gu)].map((match) => match[1])
}

function bounded(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

test("Task 10 and master Gate B freeze the exact seventeen pending migrations", async () => {
  const [solapiPlan, masterPlan] = await Promise.all([
    readFile(solapiPlanPath, "utf8"),
    readFile(masterPlanPath, "utf8"),
  ])
  const task10 = bounded(solapiPlan, "### Task 10:", "### Task 11:")
  const pendingBlock = bounded(
    task10,
    'TIPS_EXPECTED_PENDING="$(mktemp)"',
    'cmp -s "${TIPS_EXPECTED_PENDING}" "${TIPS_PENDING_BEFORE_DISPATCH}"',
  )
  const masterBaseline = bounded(
    masterPlan,
    "First installation, exact token `not_installed`",
    "Do not require a runtime probe",
  )

  assert.deepEqual(versions(pendingBlock), EXPECTED_PENDING)
  assert.deepEqual(versions(masterBaseline), EXPECTED_PENDING)
  assert.doesNotMatch(task10, /all twelve reviewed migrations|twelve-version set/u)
  assert.doesNotMatch(masterBaseline, /all twelve reviewed migrations|twelve-version set/u)
  for (const version of obsoleteVersions) {
    assert.doesNotMatch(task10, new RegExp(version, "u"))
    assert.doesNotMatch(masterBaseline, new RegExp(version, "u"))
  }
})

test("Task 10 and master Gate B reject any pre-dispatch remote-only migration", async () => {
  const [solapiPlan, masterPlan] = await Promise.all([
    readFile(solapiPlanPath, "utf8"),
    readFile(masterPlanPath, "utf8"),
  ])
  const task10 = bounded(solapiPlan, "### Task 10:", "### Task 11:")
  const remoteOnlyGuard = bounded(
    task10,
    'TIPS_REMOTE_ONLY_BEFORE_DISPATCH="$(mktemp)"',
    'TIPS_PENDING_BEFORE_DISPATCH="$(mktemp)"',
  )
  const masterBaseline = bounded(
    masterPlan,
    "First installation, exact token `not_installed`",
    "Do not require a runtime probe",
  )

  assert.match(
    remoteOnlyGuard,
    /if \(local_version == "" && remote_version ~ \/\^\[0-9\]\+\$\/ && length\(remote_version\) == 14\) print remote_version/u,
  )
  assert.match(
    remoteOnlyGuard,
    /test ! -s "\$\{TIPS_REMOTE_ONLY_BEFORE_DISPATCH\}"/u,
  )
  assert.match(
    masterBaseline,
    /remote-only migration set is empty \(`remote-only=0`\)/u,
  )
})

test("every allowed pending version has one local migration identity", async () => {
  const files = await readdir(join(repoRoot, "supabase", "migrations"))
  const counts = new Map()
  for (const file of files) {
    const match = /^(\d{14})_.+\.sql$/u.exec(file)
    if (!match) continue
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1)
  }
  for (const version of EXPECTED_PENDING) {
    assert.equal(counts.get(version), 1, version)
  }
  assert.deepEqual(
    [...counts.entries()].filter(([, count]) => count !== 1),
    [],
  )
})
