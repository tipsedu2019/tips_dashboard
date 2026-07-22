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
const requiredWorkflowPath = join(repoRoot, ".github", "workflows", "supabase-db-push.yml")
const fixtureRoots = []
const REQUIRED_DB_PUSH_WORKFLOW_SHA256 = "e9fe479cf6c90e5a1681532c88b8ce378a72456c801744582cc04bf850b135f1"

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
  assert.equal(await sha256(requiredWorkflowPath), REQUIRED_DB_PUSH_WORKFLOW_SHA256)
  for (const [file, digest] of EXPECTED_SQL) {
    assert.equal(await sha256(join(quarantineDir, file)), digest)
    await assert.rejects(readFile(join(activeDir, file)))
  }
})

test("quarantine SQL과 manifest 변조를 fail-closed로 거부한다", async () => {
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

  const manifestFixture = await createRepoFixture()
  const manifestPath = join(
    manifestFixture,
    "supabase",
    "pending-migrations",
    "notification-cutover",
    "manifest.json",
  )
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  manifest.unexpectedPolicy = "allowed"
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: manifestFixture }),
    "manifest_top_level_keys_mismatch",
  )

  const readmeFixture = await createRepoFixture()
  const readmePath = join(
    readmeFixture,
    "supabase",
    "pending-migrations",
    "notification-cutover",
    "README.md",
  )
  await appendFile(readmePath, "\n직접 적용 가능\n")
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: readmeFixture }),
    "quarantine_readme_hash_mismatch",
  )
})

test("active lane의 이름 변경, hash 복제, timestamp 재사용을 거부한다", async () => {
  const activeFixture = await createRepoFixture()
  const activeQuarantineDir = join(activeFixture, "supabase", "pending-migrations", "notification-cutover")
  const activeMigrationDir = join(activeFixture, "supabase", "migrations")
  await copyFile(join(activeQuarantineDir, EXPECTED_SQL[0][0]), join(activeMigrationDir, EXPECTED_SQL[0][0]))
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: activeFixture }),
    "cutover_sql_present_in_active_lane",
  )

  const renamedFixture = await createRepoFixture()
  const renamedQuarantineDir = join(
    renamedFixture,
    "supabase",
    "pending-migrations",
    "notification-cutover",
  )
  const renamedActiveDir = join(renamedFixture, "supabase", "migrations")
  await copyFile(
    join(renamedQuarantineDir, EXPECTED_SQL[1][0]),
    join(renamedActiveDir, "20990101000000_renamed_cutover.sql"),
  )
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: renamedFixture }),
    "cutover_sql_hash_present_in_active_lane",
  )

  const timestampFixture = await createRepoFixture()
  const timestampActiveDir = join(timestampFixture, "supabase", "migrations")
  await writeFile(
    join(timestampActiveDir, "20260716195800_placeholder.sql"),
    "select 1;\n",
  )
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: timestampFixture }),
    "cutover_timestamp_reused_in_active_lane",
  )
})

test("science superseding migration의 바이트와 contract를 고정한다", async () => {
  const scienceFixture = await createRepoFixture()
  const scienceMigrationPath = join(
    scienceFixture,
    "supabase",
    "migrations",
    "20260722120000_science_notification_connection.sql",
  )
  await appendFile(scienceMigrationPath, "\n-- drift\n")
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: scienceFixture }),
    "science_superseding_migration_hash_mismatch",
  )

  const quotedFixture = await createRepoFixture()
  await writeFile(
    join(quotedFixture, "supabase", "migrations", "20260723100000_quoted_legacy.sql"),
    `CREATE OR REPLACE FUNCTION public."revalidate_immediate_notification_delivery_v1"()
RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
`,
  )
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: quotedFixture }),
    "science_final_definition_mismatch",
  )

  const dropFixture = await createRepoFixture()
  await writeFile(
    join(dropFixture, "supabase", "migrations", "20260723100001_drop_legacy.sql"),
    "DROP FUNCTION public.prepare_notification_immediate_delivery_v1;\n",
  )
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: dropFixture }),
    "science_final_definition_mismatch",
  )

  const commentMarkerFixture = await createRepoFixture()
  await writeFile(
    join(commentMarkerFixture, "supabase", "migrations", "20260723100002_comment_markers.sql"),
    `CREATE OR REPLACE FUNCTION public.revalidate_immediate_notification_delivery_v1()
RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
-- when 'google_chat.science' then 'science'
-- v_delivery.audience_key = 'subject_team'
`,
  )
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: commentMarkerFixture }),
    "science_final_definition_mismatch",
  )
})

test("required DB push workflow의 실파일, exact command, 순서를 강제한다", async () => {
  const missingRootFixture = await createRepoFixture()
  await rm(join(missingRootFixture, ".github", "workflows"), { recursive: true })
  const missingRootErrors = await validateSupabaseMigrationLayout({ repoRoot: missingRootFixture })
  assertIncludesErrorCode(missingRootErrors, "workflow_directory_not_regular")
  assertIncludesErrorCode(missingRootErrors, "required_db_push_workflow_not_regular")

  const missingWorkflowFixture = await createRepoFixture()
  await rm(join(missingWorkflowFixture, ".github", "workflows", "supabase-db-push.yml"))
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: missingWorkflowFixture }),
    "required_db_push_workflow_not_regular",
  )

  const symlinkWorkflowFixture = await createRepoFixture()
  const symlinkWorkflowPath = join(
    symlinkWorkflowFixture,
    ".github",
    "workflows",
    "supabase-db-push.yml",
  )
  await rm(symlinkWorkflowPath)
  await symlink("missing-workflow.yml", symlinkWorkflowPath)
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: symlinkWorkflowFixture }),
    "required_db_push_workflow_not_regular",
  )

  const topLevelSymlinkFixture = await createRepoFixture()
  await symlink(
    "supabase-db-push.yml",
    join(topLevelSymlinkFixture, ".github", "workflows", "linked.yml"),
  )
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: topLevelSymlinkFixture }),
    "workflow_entry_not_regular",
  )

  const workflowFixture = await createRepoFixture()
  const workflowPath = join(workflowFixture, ".github", "workflows", "supabase-db-push.yml")
  const workflow = await readFile(workflowPath, "utf8")
  const verifierLine = /^.*node scripts\/verify-supabase-migration-layout\.mjs.*(?:\n|$)/m
  assert.match(workflow, verifierLine)
  await writeFile(workflowPath, workflow.replace(verifierLine, ""))
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: workflowFixture }),
    "layout_verifier_command_count_mismatch",
  )

  const ignoredVerifierFixture = await createRepoFixture()
  const ignoredVerifierPath = join(
    ignoredVerifierFixture,
    ".github",
    "workflows",
    "supabase-db-push.yml",
  )
  const ignoredVerifierWorkflow = await readFile(ignoredVerifierPath, "utf8")
  await writeFile(
    ignoredVerifierPath,
    ignoredVerifierWorkflow.replace(
      "run: node scripts/verify-supabase-migration-layout.mjs",
      "run: node scripts/verify-supabase-migration-layout.mjs || true",
    ),
  )
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: ignoredVerifierFixture }),
    "layout_verifier_command_count_mismatch",
  )

  const verifierIfFixture = await createRepoFixture()
  const verifierIfPath = join(verifierIfFixture, ".github", "workflows", "supabase-db-push.yml")
  const verifierIfWorkflow = await readFile(verifierIfPath, "utf8")
  await writeFile(
    verifierIfPath,
    verifierIfWorkflow.replace(
      "      - name: Verify Supabase migration layout\n",
      "      - name: Verify Supabase migration layout\n        if: false\n",
    ),
  )
  const verifierIfErrors = await validateSupabaseMigrationLayout({ repoRoot: verifierIfFixture })
  assertIncludesErrorCode(verifierIfErrors, "required_db_push_workflow_hash_mismatch")
  assertIncludesErrorCode(verifierIfErrors, "db_push_workflow_layout_bypass")

  const continueFixture = await createRepoFixture()
  const continuePath = join(continueFixture, ".github", "workflows", "supabase-db-push.yml")
  const continueWorkflow = await readFile(continuePath, "utf8")
  await writeFile(
    continuePath,
    continueWorkflow.replace(
      "      - name: Verify Supabase migration layout\n",
      "      - name: Verify Supabase migration layout\n        continue-on-error: true\n",
    ),
  )
  const continueErrors = await validateSupabaseMigrationLayout({ repoRoot: continueFixture })
  assertIncludesErrorCode(continueErrors, "required_db_push_workflow_hash_mismatch")
  assertIncludesErrorCode(continueErrors, "db_push_workflow_layout_bypass")

  const workingDirectoryFixture = await createRepoFixture()
  const workingDirectoryPath = join(
    workingDirectoryFixture,
    ".github",
    "workflows",
    "supabase-db-push.yml",
  )
  const workingDirectoryWorkflow = await readFile(workingDirectoryPath, "utf8")
  await writeFile(
    workingDirectoryPath,
    workingDirectoryWorkflow.replace(
      "      - name: Push migrations\n",
      "      - name: Push migrations\n        working-directory: supabase/pending-migrations/notification-cutover\n",
    ),
  )
  const workingDirectoryErrors = await validateSupabaseMigrationLayout({
    repoRoot: workingDirectoryFixture,
  })
  assertIncludesErrorCode(workingDirectoryErrors, "required_db_push_workflow_hash_mismatch")
  assertIncludesErrorCode(workingDirectoryErrors, "db_push_workflow_layout_bypass")

  const otherJobFixture = await createRepoFixture()
  const otherJobPath = join(otherJobFixture, ".github", "workflows", "supabase-db-push.yml")
  const otherJobWorkflow = await readFile(otherJobPath, "utf8")
  await writeFile(
    otherJobPath,
    otherJobWorkflow
      .replace(/^.*node scripts\/verify-supabase-migration-layout\.mjs.*(?:\n|$)/m, "")
      .replace(
        "jobs:\n",
        "jobs:\n  \"layout-only\":\n    runs-on: ubuntu-latest\n    steps:\n      - name: Verify layout\n        run: node scripts/verify-supabase-migration-layout.mjs\n",
      ),
  )
  const otherJobErrors = await validateSupabaseMigrationLayout({ repoRoot: otherJobFixture })
  assertIncludesErrorCode(otherJobErrors, "required_db_push_workflow_hash_mismatch")
  assertIncludesErrorCode(otherJobErrors, "db_push_without_prior_layout_verifier")

  const externalPushFixture = await createRepoFixture()
  await writeFile(
    join(externalPushFixture, ".github", "workflows", "other.yml"),
    "name: Other\non: workflow_dispatch\njobs:\n  push:\n    runs-on: ubuntu-latest\n    steps:\n      - run: supabase db push --linked --include-all\n",
  )
  assertIncludesErrorCode(
    await validateSupabaseMigrationLayout({ repoRoot: externalPushFixture }),
    "db_push_outside_required_workflow",
  )
})
