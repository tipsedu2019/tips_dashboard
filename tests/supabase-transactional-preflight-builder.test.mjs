import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test, { after } from "node:test"

const fixtureRoots = []
const builderUrl = new URL(
  "../scripts/build-supabase-transactional-preflight.mjs",
  import.meta.url,
)
const repoRoot = fileURLToPath(new URL("..", import.meta.url))
const dashboardPendingVersions = Object.freeze([
  "20260831013310",
  "20260831031913",
  "20260831052546",
  "20260831061736",
  "20260831063537",
  "20260831065351",
  "20260831101449",
  "20260831103631",
  "20260831123610",
  "20260831152429",
  "20260831164103",
  "20260831170552",
  "20260831184952",
  "20260831234634",
  "20260901045629",
  "20260901065056",
  "20260901072345",
])
const dashboardPendingFiles = Object.freeze([
  "20260831013310_management_numbered_pages.sql",
  "20260831031913_ops_task_numbered_pages.sql",
  "20260831052546_academic_operations_numbered_pages.sql",
  "20260831061736_approval_numbered_pages.sql",
  "20260831063537_approval_detail_trim_parity.sql",
  "20260831065351_makeup_numbered_pages.sql",
  "20260831101449_makeup_system_note_whitespace_parity.sql",
  "20260831103631_makeup_source_precision_parity.sql",
  "20260831123610_textbook_inventory_numbered_reads.sql",
  "20260831152429_textbook_workflow_numbered_reads.sql",
  "20260831164103_textbook_workflow_purchase_cost_whitespace.sql",
  "20260831170552_textbook_closing_work_context_reads.sql",
  "20260831184952_textbook_reference_numbered_reads.sql",
  "20260831234634_textbook_class_sale_roster_school.sql",
  "20260901045629_textbook_supplier_numbered_reads.sql",
  "20260901065056_textbook_owner_settings_contract_fix.sql",
  "20260901072345_textbook_taxonomy_numbered_drafts.sql",
])

const supabaseCli2115Ledger = JSON.stringify({
  migrations: [
    { local: "20260820150057", remote: "20260820150057", time: "2026-08-20 15:00:57" },
    { local: "20260820152710", remote: "", time: "2026-08-20 15:27:10" },
    { local: "20260820160000", remote: "", time: "2026-08-20 16:00:00" },
  ],
  message: "Migrations listed",
})

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

test("각 forward migration 경계에서 deferred constraint events를 commit처럼 검증한다", async () => {
  const { buildTransactionalPreflightSql } = await import(builderUrl)
  const { root, ledger } = await createFixture()
  const result = await buildTransactionalPreflightSql({
    repoRoot: root,
    migrationLedger: ledger,
    forwardMigrationsPath: "supabase/migrations",
    focusedTestPath: "supabase/tests/focused.sql",
  })

  assert.match(
    result.sql,
    /pending_first_marker[\s\S]*set constraints all immediate;[\s\S]*set constraints all deferred;[\s\S]*-- end migration 20260820152710[\s\S]*pending_second_marker/u,
  )
  assert.match(
    result.sql,
    /pending_second_marker[\s\S]*set constraints all immediate;[\s\S]*set constraints all deferred;[\s\S]*-- end migration 20260820160000[\s\S]*select no_plan\(\);/u,
  )
  assert.equal(
    (result.sql.match(/^set constraints all immediate;$/gimu) ?? []).length,
    result.pendingVersions.length,
  )
  assert.equal(
    (result.sql.match(/^set constraints all deferred;$/gimu) ?? []).length,
    result.pendingVersions.length,
  )
})

test("Supabase CLI 2.115 JSON ledger에서 forward migrations만 정확히 고른다", async () => {
  const { buildTransactionalPreflightSql } = await import(builderUrl)
  const { root } = await createFixture({ ledger: supabaseCli2115Ledger })
  const result = await buildTransactionalPreflightSql({
    repoRoot: root,
    migrationLedger: supabaseCli2115Ledger,
    forwardMigrationsPath: "supabase/migrations",
    focusedTestPath: "supabase/tests/focused.sql",
  })

  assert.deepEqual(result.pendingVersions, ["20260820152710", "20260820160000"])
  assert.doesNotMatch(result.sql, /applied_marker/)
  assert.match(result.sql, /pending_first_marker/)
  assert.match(result.sql, /pending_second_marker/)
})

test("Supabase CLI JSON ledger 구조가 다르면 fail closed 한다", async () => {
  const { buildTransactionalPreflightSql } = await import(builderUrl)
  const malformedLedgers = [
    "{",
    JSON.stringify({ migrations: {}, message: "Migrations listed" }),
    JSON.stringify({ migrations: [], message: "unexpected" }),
    JSON.stringify({ migrations: [], message: "Migrations listed", extra: true }),
    JSON.stringify({
      migrations: [{ local: "20260820150057", remote: "20260820150057" }],
      message: "Migrations listed",
    }),
    JSON.stringify({
      migrations: [{ local: "2026082015005", remote: "2026082015005", time: "now" }],
      message: "Migrations listed",
    }),
    JSON.stringify({
      migrations: [{ local: "202608201500577", remote: "202608201500577", time: "now" }],
      message: "Migrations listed",
    }),
    JSON.stringify({
      migrations: [{ local: 20260820150057, remote: "20260820150057", time: "now" }],
      message: "Migrations listed",
    }),
    JSON.stringify({
      migrations: [{ local: "", remote: "", time: "now" }],
      message: "Migrations listed",
    }),
  ]

  for (const migrationLedger of malformedLedgers) {
    const { root } = await createFixture({ ledger: migrationLedger })
    await assert.rejects(
      buildTransactionalPreflightSql({
        repoRoot: root,
        migrationLedger,
        forwardMigrationsPath: "supabase/migrations",
        focusedTestPath: "supabase/tests/focused.sql",
      }),
      { message: "transactional_preflight_ledger_malformed" },
    )
  }
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

  await assert.rejects(
    buildTransactionalPreflightSql({
      repoRoot: root,
      migrationLedger: JSON.stringify({
        migrations: [
          { local: "20260820152710", remote: "", time: "2026-08-20 15:27:10" },
        ],
        message: "Migrations listed",
      }),
      forwardMigrationsPath: "supabase/migrations",
      focusedTestPath: "supabase/tests/focused.sql",
    }),
    { message: "transactional_preflight_remote_ledger_missing" },
  )
})

test("remote-only 또는 과거 local-only ledger drift는 migration 선택 전에 fail closed 한다", async () => {
  const { buildTransactionalPreflightSql } = await import(builderUrl)
  const remoteOnly = await createFixture()
  await assert.rejects(
    buildTransactionalPreflightSql({
      repoRoot: remoteOnly.root,
      migrationLedger: [
        "Local | Remote | Time",
        "20260820150057 | 20260820150057 | now",
        " | 20260820151500 | now",
        "20260820152710 | | now",
      ].join("\n"),
      forwardMigrationsPath: "supabase/migrations",
      focusedTestPath: "supabase/tests/focused.sql",
    }),
    { message: "transactional_preflight_remote_history_drift" },
  )

  await assert.rejects(
    buildTransactionalPreflightSql({
      repoRoot: remoteOnly.root,
      migrationLedger: JSON.stringify({
        migrations: [
          { local: "20260820150057", remote: "20260820150057", time: "2026-08-20 15:00:57" },
          { local: "", remote: "20260820151500", time: "2026-08-20 15:15:00" },
          { local: "20260820152710", remote: "", time: "2026-08-20 15:27:10" },
        ],
        message: "Migrations listed",
      }),
      forwardMigrationsPath: "supabase/migrations",
      focusedTestPath: "supabase/tests/focused.sql",
    }),
    { message: "transactional_preflight_remote_history_drift" },
  )

  const historicalLocalOnly = await createFixture()
  await assert.rejects(
    buildTransactionalPreflightSql({
      repoRoot: historicalLocalOnly.root,
      migrationLedger: [
        "Local | Remote | Time",
        "20260820140000 | | now",
        "20260820150057 | 20260820150057 | now",
        "20260820152710 | | now",
      ].join("\n"),
      forwardMigrationsPath: "supabase/migrations",
      focusedTestPath: "supabase/tests/focused.sql",
    }),
    { message: "transactional_preflight_unapplied_legacy_migration" },
  )

  await assert.rejects(
    buildTransactionalPreflightSql({
      repoRoot: historicalLocalOnly.root,
      migrationLedger: JSON.stringify({
        migrations: [
          { local: "20260820140000", remote: "", time: "2026-08-20 14:00:00" },
          { local: "20260820150057", remote: "20260820150057", time: "2026-08-20 15:00:57" },
          { local: "20260820152710", remote: "", time: "2026-08-20 15:27:10" },
        ],
        message: "Migrations listed",
      }),
      forwardMigrationsPath: "supabase/migrations",
      focusedTestPath: "supabase/tests/focused.sql",
    }),
    { message: "transactional_preflight_unapplied_legacy_migration" },
  )
})

test("현재 final manifest의 exact interleaved pending 집합만 운영 remote max 이전이어도 사전 검증한다", async () => {
  const { buildTransactionalPreflightSql } = await import(builderUrl)
  const root = await mkdtemp(join(tmpdir(), "tips-dashboard-interleaved-preflight-"))
  fixtureRoots.push(root)
  await mkdir(join(root, "supabase", "migrations"), { recursive: true })
  await mkdir(join(root, "supabase", "tests"), { recursive: true })
  await Promise.all(dashboardPendingFiles.map(async (fileName) => {
    await writeFile(
      join(root, "supabase", "migrations", fileName),
      await readFile(join(repoRoot, "supabase", "migrations", fileName)),
    )
  }))
  await writeFile(
    join(root, "supabase", "tests", "focused.sql"),
    await readFile(
      join(repoRoot, "supabase", "tests", "registration_level_test_result_parent_reconciliation_test.sql"),
    ),
  )
  const migrationLedger = JSON.stringify({
    migrations: [
      {
        local: "20260831151654",
        remote: "20260831151654",
        time: "2026-08-31 15:16:54",
      },
      ...dashboardPendingVersions.map((version) => ({
        local: version,
        remote: "",
        time: "2026-09-01 00:00:00",
      })),
    ],
    message: "Migrations listed",
  })

  const result = await buildTransactionalPreflightSql({
    repoRoot: root,
    migrationLedger,
    forwardMigrationsPath: "supabase/migrations",
    focusedTestPath: "supabase/tests/focused.sql",
  })

  assert.deepEqual(result.pendingVersions, dashboardPendingVersions)
  assert.deepEqual(result.interleavedPendingVersions, dashboardPendingVersions.slice(0, 9))
  assert.match(result.sql, /transactional preflight migration 20260831013310/u)
  assert.match(result.sql, /transactional preflight migration 20260901072345/u)
  assert.match(result.sql.trimEnd(), /rollback;$/iu)
})

test("forward migration 파일과 linked ledger의 pending 집합이 다르면 fail closed 한다", async () => {
  const { buildTransactionalPreflightSql } = await import(builderUrl)
  const { root } = await createFixture()

  await assert.rejects(
    buildTransactionalPreflightSql({
      repoRoot: root,
      migrationLedger: [
        "Local | Remote | Time",
        "20260820150057 | 20260820150057 | now",
        "20260820152710 | | now",
      ].join("\n"),
      forwardMigrationsPath: "supabase/migrations",
      focusedTestPath: "supabase/tests/focused.sql",
    }),
    { message: "transactional_preflight_pending_ledger_mismatch" },
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

  const inlineEscape = await createFixture({
    pendingSource: "begin;\nselect 'before'; commit; select 'after';\ncommit;\n",
  })
  await assert.rejects(
    buildTransactionalPreflightSql({
      repoRoot: inlineEscape.root,
      migrationLedger: inlineEscape.ledger,
      forwardMigrationsPath: "supabase/migrations",
      focusedTestPath: "supabase/tests/focused.sql",
    }),
    { message: "transactional_preflight_migration_escape_forbidden" },
  )

  const commentedEscape = await createFixture({
    pendingSource: "begin;\nselect 'before'; /* boundary */ rollback;\ncommit;\n",
  })
  await assert.rejects(
    buildTransactionalPreflightSql({
      repoRoot: commentedEscape.root,
      migrationLedger: commentedEscape.ledger,
      forwardMigrationsPath: "supabase/migrations",
      focusedTestPath: "supabase/tests/focused.sql",
    }),
    { message: "transactional_preflight_migration_escape_forbidden" },
  )

  const safeDollarBody = await createFixture({
    pendingSource: [
      "begin;",
      "create function public.safe_text() returns text language plpgsql as $fn$",
      "begin",
      "  return 'commit; rollback;';",
      "end;",
      "$fn$;",
      "commit;",
      "",
    ].join("\n"),
  })
  const safeResult = await buildTransactionalPreflightSql({
    repoRoot: safeDollarBody.root,
    migrationLedger: safeDollarBody.ledger,
    forwardMigrationsPath: "supabase/migrations",
    focusedTestPath: "supabase/tests/focused.sql",
  })
  assert.match(safeResult.sql, /return 'commit; rollback;'/)

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

test("opaque SQL 밖의 psql meta command와 prepared transaction 우회를 모두 거부한다", async () => {
  const { buildTransactionalPreflightSql } = await import(builderUrl)

  for (const pendingSource of [
    [
      "begin;",
      "select 'COMMIT' \\gexec",
      "create table public.escape_probe(id integer);",
      "commit;",
      "",
    ].join("\n"),
    "begin;\nselect 1 \\connect postgres\ncommit;\n",
    "begin;\nselect 1 \\i /tmp/escape.sql\ncommit;\n",
  ]) {
    const fixture = await createFixture({ pendingSource })
    await assert.rejects(
      buildTransactionalPreflightSql({
        repoRoot: fixture.root,
        migrationLedger: fixture.ledger,
        forwardMigrationsPath: "supabase/migrations",
        focusedTestPath: "supabase/tests/focused.sql",
      }),
      { message: "transactional_preflight_migration_escape_forbidden" },
    )
  }

  const unsafeFocusedTest = await createFixture({
    focusedSource: [
      "begin;",
      "set local role postgres;",
      "select 'ROLLBACK' \\gexec",
      "select no_plan();",
      "rollback;",
      "",
    ].join("\n"),
  })
  await assert.rejects(
    buildTransactionalPreflightSql({
      repoRoot: unsafeFocusedTest.root,
      migrationLedger: unsafeFocusedTest.ledger,
      forwardMigrationsPath: "supabase/migrations",
      focusedTestPath: "supabase/tests/focused.sql",
    }),
    { message: "transactional_preflight_migration_escape_forbidden" },
  )

  const preparedTransaction = await createFixture({
    pendingSource: [
      "begin;",
      "select 'before_prepare';",
      "prepare transaction 'transactional_preflight_escape';",
      "commit;",
      "",
    ].join("\n"),
  })
  await assert.rejects(
    buildTransactionalPreflightSql({
      repoRoot: preparedTransaction.root,
      migrationLedger: preparedTransaction.ledger,
      forwardMigrationsPath: "supabase/migrations",
      focusedTestPath: "supabase/tests/focused.sql",
    }),
    { message: "transactional_preflight_migration_escape_forbidden" },
  )

  const safePreparedStatement = await createFixture({
    pendingSource: [
      "begin;",
      "prepare transaction AS SELECT 1;",
      "execute transaction;",
      "deallocate transaction;",
      "commit;",
      "",
    ].join("\n"),
  })
  const safePreparedResult = await buildTransactionalPreflightSql({
    repoRoot: safePreparedStatement.root,
    migrationLedger: safePreparedStatement.ledger,
    forwardMigrationsPath: "supabase/migrations",
    focusedTestPath: "supabase/tests/focused.sql",
  })
  assert.match(safePreparedResult.sql, /prepare transaction AS SELECT 1;/i)
})
