import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test, { after } from "node:test"

const fixtureRoots = []
const builderUrl = new URL(
  "../scripts/build-supabase-transactional-preflight.mjs",
  import.meta.url,
)

async function createFixture({
  ledger = [
    "   Local          | Remote         | Time (UTC)",
    "  ----------------|----------------|---------------------",
    "   20260820150057 | 20260820150057 | 2026-08-20 15:00:57",
    "   20260820152710 |                | 2026-08-20 15:27:10",
    "   20260820160000 |                | 2026-08-20 16:00:00",
  ].join("\n"),
  pendingSource = "begin;\nselect 'pending_first_marker';\ncommit;\n",
  secondPendingSource = "begin;\nselect 'pending_second_marker';\ncommit;\n",
  focusedSource = [
    "begin;",
    "set local role postgres;",
    "set local search_path = extensions, public;",
    "select no_plan();",
    "select * from finish();",
    "rollback;",
    "",
  ].join("\n"),
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "tips-supabase-transactional-preflight-"))
  fixtureRoots.push(root)
  await mkdir(join(root, "supabase", "migrations"), { recursive: true })
  await mkdir(join(root, "supabase", "tests"), { recursive: true })
  await writeFile(
    join(root, "supabase", "migrations", "20260820150057_applied.sql"),
    "begin;\nselect 'applied_marker';\ncommit;\n",
  )
  await writeFile(
    join(root, "supabase", "migrations", "20260820152710_pending_first.sql"),
    pendingSource,
  )
  await writeFile(
    join(root, "supabase", "migrations", "20260820160000_pending_second.sql"),
    secondPendingSource,
  )
  await writeFile(join(root, "supabase", "tests", "focused.sql"), focusedSource)
  return { root, ledger }
}

after(async () => {
  await Promise.all(fixtureRoots.map((root) => rm(root, { force: true, recursive: true })))
})

test("linked ledger 이후의 forward migrations만 순서대로 넣고 하나의 rollback envelope를 보존한다", async () => {
  const { buildTransactionalPreflightSql } = await import(builderUrl)
  const { root, ledger } = await createFixture()
  const result = await buildTransactionalPreflightSql({
    repoRoot: root,
    migrationLedger: ledger,
    forwardMigrationsPath: "supabase/migrations",
    focusedTestPath: "supabase/tests/focused.sql",
  })

  assert.deepEqual(result.pendingVersions, ["20260820152710", "20260820160000"])
  assert.doesNotMatch(result.sql, /applied_marker/)
  assert.match(result.sql, /pending_first_marker/)
  assert.match(result.sql, /pending_second_marker/)
  assert.ok(
    result.sql.indexOf("pending_first_marker") < result.sql.indexOf("pending_second_marker"),
  )
  assert.ok(
    result.sql.indexOf("set local role postgres;") < result.sql.indexOf("pending_first_marker"),
  )
  assert.ok(result.sql.indexOf("pending_second_marker") < result.sql.indexOf("select no_plan();"))
  assert.equal((result.sql.match(/^begin;$/gim) ?? []).length, 1)
  assert.equal((result.sql.match(/^commit;$/gim) ?? []).length, 0)
  assert.equal((result.sql.match(/^rollback;$/gim) ?? []).length, 1)
  assert.match(result.sql.trimEnd(), /rollback;$/i)
})

test("remote max가 최신 local migration이면 schema mutation 없이 focused test만 만든다", async () => {
  const { buildTransactionalPreflightSql } = await import(builderUrl)
  const { root } = await createFixture()
  const migrationLedger = [
    "   Local          | Remote         | Time (UTC)",
    "  ----------------|----------------|---------------------",
    "   20260820160000 | 20260820160000 | 2026-08-20 16:00:00",
  ].join("\n")
  const result = await buildTransactionalPreflightSql({
    repoRoot: root,
    migrationLedger,
    forwardMigrationsPath: "supabase/migrations",
    focusedTestPath: "supabase/tests/focused.sql",
  })

  assert.deepEqual(result.pendingVersions, [])
  assert.doesNotMatch(result.sql, /pending_(?:first|second)_marker/)
  assert.match(result.sql, /select no_plan\(\);/)
  assert.match(result.sql.trimEnd(), /rollback;$/i)
})

test("remote version이 없는 ledger는 fail closed 한다", async () => {
  const { buildTransactionalPreflightSql } = await import(builderUrl)
  const { root } = await createFixture({
    ledger: [
      "   Local          | Remote         | Time (UTC)",
      "  ----------------|----------------|---------------------",
      "   20260820152710 |                | 2026-08-20 15:27:10",
    ].join("\n"),
  })

  await assert.rejects(
    buildTransactionalPreflightSql({
      repoRoot: root,
      migrationLedger: "Local | Remote | Time\n20260820152710 | | now",
      forwardMigrationsPath: "supabase/migrations",
      focusedTestPath: "supabase/tests/focused.sql",
    }),
    { message: "transactional_preflight_remote_ledger_missing" },
  )
})

test("migration이나 focused test가 transaction 밖으로 탈출하려 하면 거부한다", async () => {
  const { buildTransactionalPreflightSql } = await import(builderUrl)
  const unsafeMigration = await createFixture({
    pendingSource: [
      "begin;",
      "select 'before_escape';",
      "commit;",
      "select 'after_escape';",
      "commit;",
    ].join("\n"),
  })
  await assert.rejects(
    buildTransactionalPreflightSql({
      repoRoot: unsafeMigration.root,
      migrationLedger: unsafeMigration.ledger,
      forwardMigrationsPath: "supabase/migrations",
      focusedTestPath: "supabase/tests/focused.sql",
    }),
    { message: "transactional_preflight_migration_escape_forbidden" },
  )

  const unsafeTest = await createFixture({
    focusedSource: "begin;\nset local role postgres;\nselect no_plan();\ncommit;\n",
  })
  await assert.rejects(
    buildTransactionalPreflightSql({
      repoRoot: unsafeTest.root,
      migrationLedger: unsafeTest.ledger,
      forwardMigrationsPath: "supabase/migrations",
      focusedTestPath: "supabase/tests/focused.sql",
    }),
    { message: "transactional_preflight_test_rollback_required" },
  )
})
