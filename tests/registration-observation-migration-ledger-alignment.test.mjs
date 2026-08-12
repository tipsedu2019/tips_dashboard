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
import { spawnSync } from "node:child_process"
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
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

function preDispatchShell(task10) {
  return bounded(
    task10,
    'TIPS_REMOTE_ONLY_BEFORE_DISPATCH="$(mktemp)"',
    'TIPS_DB_RUN_ID="$(gh run list',
  )
}

async function runPreDispatchFixture({ localOnly, remoteOnly }) {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "tips-observation-ledger-guard-"))
  const ledgerPath = join(fixtureRoot, "ledger.txt")
  const ghSentinelPath = join(fixtureRoot, "gh-called.txt")
  const ledgerRows = [
    ...localOnly.map((version) => `${version} |`),
    ...remoteOnly.map((version) => ` | ${version}`),
  ]
  await writeFile(ledgerPath, `${ledgerRows.join("\n")}\n`)

  const task10 = bounded(
    await readFile(solapiPlanPath, "utf8"),
    "### Task 10:",
    "### Task 11:",
  )
  const result = spawnSync(
    "/bin/bash",
    [
      "-c",
      [
        'gh() { printf \'%s\\n\' "$*" >> "${GH_SENTINEL_PATH}"; }',
        preDispatchShell(task10),
      ].join("\n"),
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GH_SENTINEL_PATH: ghSentinelPath,
        TIPS_FEATURE_REF: "fixture-only-ref",
        TIPS_LEDGER_BEFORE_DISPATCH: ledgerPath,
      },
    },
  )

  let ghCalled = false
  try {
    await readFile(ghSentinelPath, "utf8")
    ghCalled = true
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true })
  }

  return { ...result, ghCalled }
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
    masterBaseline,
    /remote-only migration set is empty \(`remote-only=0`\)/u,
  )
})

test("Task 10 remote-only guard exits before workflow dispatch", async () => {
  const result = await runPreDispatchFixture({
    localOnly: EXPECTED_PENDING,
    remoteOnly: ["20260813123456"],
  })

  assert.notEqual(
    result.status,
    0,
    `remote-only drift must fail the shell, received stdout=${result.stdout} stderr=${result.stderr}`,
  )
  assert.equal(result.ghCalled, false, "remote-only drift must stop before gh workflow run")
})

test("Task 10 exact-seventeen guard exits before workflow dispatch", async () => {
  const result = await runPreDispatchFixture({
    localOnly: EXPECTED_PENDING.slice(0, -1),
    remoteOnly: [],
  })

  assert.notEqual(
    result.status,
    0,
    `pending-set drift must fail the shell, received stdout=${result.stdout} stderr=${result.stderr}`,
  )
  assert.equal(result.ghCalled, false, "pending-set drift must stop before gh workflow run")
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
