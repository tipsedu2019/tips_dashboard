import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  appendFile,
  copyFile,
  cp,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test, { after } from "node:test"

import { validateSupabaseMigrationLayout } from "../scripts/verify-supabase-migration-layout.mjs"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const activeDir = join(repoRoot, "supabase", "migrations")
const quarantineDir = join(repoRoot, "supabase", "pending-migrations", "notification-cutover")
const fixtureRoots = []

const EXPECTED_SQL = Object.freeze([
  ["20260716195000_notification_workflow_legacy_closure.sql", "e9131131f0d9419a4a8fdf5d69a58a1047a41583f98d9ef7b5b376374ee52975"],
  ["20260716195500_notification_worker_schedule.sql", "f9f335e00bb3bba815019dcf5ce73905c8de883db90ec7c99d35ae99d2609696"],
  ["20260716195800_notification_registration_provider_claim.sql", "c682f44b0c851e49b7cec14e703ee7504bdd19b8be2416a49fc8112058826877"],
  ["20260716195900_notification_control_plane_forward_compat.sql", "054914802ac9d0d9475fd18f2b52deb7bfd27552a3b92b7b5331c6d35003ee11"],
  ["20260716196000_notification_shadow_fixture_runner.sql", "ef3ebb3a345bc734343526655fd614f51a8415dbc3a87ce1a60e8e76aa91ebd1"],
  ["20260717145304_notification_shadow_deterministic_evidence.sql", "610c1ce889aa5d7deb29a5d48186976a400774a75e347f600386068af1744833"],
])

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex")
}

async function createRepoFixture() {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "tips-supabase-migration-layout-"))
  fixtureRoots.push(fixtureRoot)
  await Promise.all([
    cp(join(repoRoot, ".github"), join(fixtureRoot, ".github"), { recursive: true }),
    cp(join(repoRoot, "supabase"), join(fixtureRoot, "supabase"), { recursive: true }),
  ])
  return fixtureRoot
}

function assertIncludesErrorCode(errors, code) {
  assert.ok(
    errors.some((error) => error.includes(code)),
    `expected ${code}, received ${JSON.stringify(errors)}`,
  )
}

after(async () => {
  await Promise.all(fixtureRoots.map((fixtureRoot) => rm(fixtureRoot, { force: true, recursive: true })))
})

test("cutover SQL은 active lane 밖의 immutable quarantine에만 존재한다", async () => {
  const errors = await validateSupabaseMigrationLayout({ repoRoot })
  assert.deepEqual(errors, [])
  for (const [file, digest] of EXPECTED_SQL) {
    assert.equal(await sha256(join(quarantineDir, file)), digest)
    await assert.rejects(readFile(join(activeDir, file)))
  }
})

test("layout과 DB push workflow 변조를 fail-closed로 거부한다", async () => {
  const hashFixture = await createRepoFixture()
  const hashQuarantineDir = join(hashFixture, "supabase", "pending-migrations", "notification-cutover")
  await appendFile(join(hashQuarantineDir, EXPECTED_SQL[0][0]), "\n")
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: hashFixture }),
    "cutover_sql_hash_mismatch",
  )

  const symlinkFixture = await createRepoFixture()
  const symlinkQuarantineDir = join(symlinkFixture, "supabase", "pending-migrations", "notification-cutover")
  await symlink(EXPECTED_SQL[0][0], join(symlinkQuarantineDir, "unexpected-cutover-link.sql"))
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: symlinkFixture }),
    "quarantine_entry_not_regular",
  )

  const activeFixture = await createRepoFixture()
  const activeQuarantineDir = join(activeFixture, "supabase", "pending-migrations", "notification-cutover")
  const activeMigrationDir = join(activeFixture, "supabase", "migrations")
  await copyFile(join(activeQuarantineDir, EXPECTED_SQL[0][0]), join(activeMigrationDir, EXPECTED_SQL[0][0]))
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: activeFixture }),
    "cutover_sql_present_in_active_lane",
  )

  const workflowFixture = await createRepoFixture()
  const workflowPath = join(workflowFixture, ".github", "workflows", "supabase-db-push.yml")
  const workflow = await readFile(workflowPath, "utf8")
  const verifierLine = /^.*node scripts\/verify-supabase-migration-layout\.mjs.*(?:\n|$)/m
  assert.match(workflow, verifierLine)
  await writeFile(workflowPath, workflow.replace(verifierLine, ""))
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: workflowFixture }),
    "db_push_without_prior_layout_verifier",
  )
})
