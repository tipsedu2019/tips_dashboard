import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
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
const retirementFile = "20260909084130_retire_tasks_and_word_retest_notifications.sql"
const retirementAlter = [
  "alter table dashboard_private.notification_rules",
  "  add constraint notification_rules_unused_workflows_retired_check",
  "  check (not enabled or workflow_key not in ('tasks','word_retests')) not valid;",
].join("\n")
const retirementCheckpoint = "set constraints dashboard_private.notification_rules_active_template_fkey immediate;"
const retirementRestore = "set constraints dashboard_private.notification_rules_active_template_fkey deferred;"
const postgresFixtureOwnerLabel = "tips.transactional-preflight-fixture-owner"
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

async function createRetirementFixture({ source, file = retirementFile } = {}) {
  const fixture = await createFixture()
  const contents = source ?? await readFile(join(repoRoot, "supabase/migrations", retirementFile), "utf8")
  await writeFile(join(fixture.root, "supabase/migrations", file), contents)
  fixture.ledger += "\n   20260909084130 |                | 2026-09-09 08:41:30"
  return { ...fixture, contents }
}

async function buildFixturePreflight(fixture) {
  const { buildTransactionalPreflightSql } = await import(builderUrl)
  return buildTransactionalPreflightSql({
    repoRoot: fixture.root,
    migrationLedger: fixture.ledger,
    forwardMigrationsPath: "supabase/migrations",
    focusedTestPath: "supabase/tests/focused.sql",
  })
}

function cleanupOwnedPostgres17Fixture(invoke, name, ownerNonce) {
  const inspected = invoke([
    "container", "inspect", "--format", `{{ index .Config.Labels "${postgresFixtureOwnerLabel}" }}`, name,
  ])
  if (inspected.status === 1 && [
    `Error: No such container: ${name}`,
    `Error: No such object: ${name}`,
  ].includes(inspected.stderr.trim())) return
  assert.equal(inspected.status, 0, inspected.stderr || inspected.error?.message)
  assert.equal(inspected.stdout.trim(), ownerNonce, "refusing to remove a container without the exact fixture owner label")
  const removed = invoke(["rm", "--force", name])
  assert.equal(removed.status, 0, removed.stderr)
}

after(async () => {
  await Promise.all(fixtureRoots.map((root) => rm(root, { force: true, recursive: true })))
})

test("공유 DB의 학습지 이력 누락은 거부하고 정확한 원격 버전 정렬 후 SQL 재실행은 0건이다", async () => {
  const { buildTransactionalPreflightSql } = await import(builderUrl)
  const { root } = await createFixture()
  const version = "20260909091156"
  const ledgerRows = ["20260820150057", "20260820152710", "20260820160000"]
    .map((value) => ({ local: value, remote: value, time: "now" }))
  ledgerRows.push({ local: "", remote: version, time: "2026-09-09 09:11:56" })
  const options = {
    repoRoot: root,
    forwardMigrationsPath: "supabase/migrations",
    focusedTestPath: "supabase/tests/focused.sql",
  }
  const ledger = () => JSON.stringify({ message: "Migrations listed", migrations: ledgerRows })
  await assert.rejects(
    buildTransactionalPreflightSql({ ...options, migrationLedger: ledger() }),
    { message: "transactional_preflight_remote_history_drift" },
  )

  const file = `${version}_worksheet_history_summaries.sql`
  await writeFile(
    join(root, "supabase/migrations", file),
    await readFile(join(repoRoot, "supabase/migrations", file)),
  )
  ledgerRows.at(-1).local = version
  const result = await buildTransactionalPreflightSql({ ...options, migrationLedger: ledger() })
  assert.deepEqual(result.pendingVersions, [])
  assert.deepEqual(result.pendingFiles, [])
  assert.equal(result.remoteMaxVersion, version)
  assert.doesNotMatch(result.sql, /worksheet_history_summaries|transactional preflight migration/)
  assert.match(result.sql, /rollback;/i)

  ledgerRows.push({ local: "", remote: "20260909091157", time: "now" })
  await assert.rejects(
    buildTransactionalPreflightSql({ ...options, migrationLedger: ledger() }),
    { message: "transactional_preflight_remote_history_drift" },
  )
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

test("emoji in SQL literals, identifiers, comments and dollar bodies preserves UTF-16 statement offsets", async () => {
  const { buildTransactionalPreflightSql } = await import(builderUrl)
  const body = [
    "-- 📝 안내",
    "/* 🧑‍🏫 nested /* 🎓 */ comment */",
    "select '📝 안내', E'📝\\n안내' as \"📝 결과\";",
    "do $body$ begin perform '📝 완료'; end; $body$;",
    "select 'tail_marker';",
  ].join("\n")
  const fixture = await createFixture({ pendingSource: `begin;\n${body}\ncommit;\n` })
  const result = await buildTransactionalPreflightSql({
    repoRoot: fixture.root, migrationLedger: fixture.ledger,
    forwardMigrationsPath: "supabase/migrations", focusedTestPath: "supabase/tests/focused.sql",
  })
  assert.ok(result.sql.includes(body))
  assert.equal((result.sql.match(/^commit;$/gim) ?? []).length, 0)
  assert.equal((result.sql.match(/^rollback;$/gim) ?? []).length, 1)

  for (const escape of ["commit; select 1;", "select 1 \\gexec\n;"]) {
    const unsafe = await createFixture({ pendingSource: `begin;\n${body}\n${escape}\ncommit;\n` })
    await assert.rejects(buildTransactionalPreflightSql({
      repoRoot: unsafe.root, migrationLedger: unsafe.ledger,
      forwardMigrationsPath: "supabase/migrations", focusedTestPath: "supabase/tests/focused.sql",
    }), { message: "transactional_preflight_migration_escape_forbidden" })
  }
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

test("the exact notification retirement adds only a named checkpoint around its original ALTER", async () => {
  const fixture = await createRetirementFixture()
  const result = await buildFixturePreflight(fixture)
  const originalBody = fixture.contents.slice(fixture.contents.indexOf("begin;") + 6, fixture.contents.lastIndexOf("commit;")).trim()
  const marker = `-- transactional preflight migration 20260909084130: ${retirementFile}\n`
  const sectionStart = result.sql.indexOf(marker) + marker.length
  assert.ok(sectionStart >= marker.length)
  const sectionEnd = result.sql.indexOf("\n-- enforce the deferred-constraint checks", sectionStart)
  const adaptedBody = result.sql.slice(sectionStart, sectionEnd)
  assert.equal(adaptedBody.split(retirementCheckpoint).length - 1, 1)
  assert.equal(adaptedBody.split(retirementRestore).length - 1, 1)
  assert.ok(adaptedBody.includes(`${retirementCheckpoint}\n${retirementAlter}\n${retirementRestore}`))
  assert.equal(adaptedBody.replace(`${retirementCheckpoint}\n`, "").replace(`\n${retirementRestore}`, ""), originalBody)
  assert.ok(adaptedBody.indexOf("where workflow_key in ('tasks','word_retests') and enabled;") < adaptedBody.indexOf(retirementCheckpoint))
  assert.ok(adaptedBody.indexOf(retirementRestore) < adaptedBody.indexOf("update dashboard_private.notification_deliveries"))
  assert.equal((result.sql.match(/^set constraints all immediate;$/gimu) ?? []).length, 3)
  assert.equal((result.sql.match(/^set constraints all deferred;$/gimu) ?? []).length, 3)
  assert.equal((result.sql.match(/^begin;$/gimu) ?? []).length, 1)
  assert.equal((result.sql.match(/^commit;$/gimu) ?? []).length, 0)
  assert.match(result.sql.trimEnd(), /select \* from finish\(\);\nrollback;$/u)
})

test("notification retirement refuses any source hash drift before adapting generated SQL", async () => {
  const source = await readFile(join(repoRoot, "supabase/migrations", retirementFile), "utf8")
  for (const changed of [
    source + "\n",
    source.replace("not valid;", "not valid;\n-- changed source"),
    source.replace(retirementAlter, retirementAlter + "\n" + retirementAlter),
    source.replace(retirementAlter, "select 1;"),
  ]) {
    const fixture = await createRetirementFixture({ source: changed })
    await assert.rejects(buildFixturePreflight(fixture), {
      message: "transactional_preflight_notification_retirement_hash_mismatch",
    })
  }
})

test("the same SQL in an unrelated filename receives no notification-specific checkpoint", async () => {
  const fixture = await createRetirementFixture({ file: "20260909084130_unrelated_retirement.sql" })
  const result = await buildFixturePreflight(fixture)
  assert.ok(result.sql.includes(retirementAlter))
  assert.ok(result.sql.includes(fixture.contents.slice(6, fixture.contents.lastIndexOf("commit;")).trim()))
  assert.equal(result.sql.includes(retirementCheckpoint), false)
  assert.equal(result.sql.includes(retirementRestore), false)
})

test("the notification checkpoint requires one complete executable ALTER anchor", async () => {
  const { addNotificationRetirementPreflightCheckpoint } = await import(builderUrl)
  const original = `select 'prefix';\n\n${retirementAlter}\n\nselect 'suffix';`
  const adapted = addNotificationRetirementPreflightCheckpoint(original)
  assert.equal(adapted.replace(`${retirementCheckpoint}\n`, "").replace(`\n${retirementRestore}`, ""), original)
  for (const body of [
    "select 1;",
    retirementAlter.replace("not valid;", "not valid"),
    retirementAlter + "\n" + retirementAlter,
    `/* ${retirementAlter} */\nselect 1;`,
    `do $opaque$ begin perform 1; /* ${retirementAlter} */ end; $opaque$;`,
  ]) {
    assert.throws(() => addNotificationRetirementPreflightCheckpoint(body), {
      message: body.endsWith("not valid")
        ? "transactional_preflight_sql_statement_unterminated"
        : "transactional_preflight_notification_retirement_anchor_invalid",
    })
  }
})

test("owned PostgreSQL fixture cleanup verifies labels and fails closed on uncertain inspection", () => {
  const name = "tips-preflight-postgres17-owned-fixture"
  const owner = "synthetic-owner-nonce"
  const calls = []
  cleanupOwnedPostgres17Fixture((args) => {
    calls.push(args)
    return args[0] === "container"
      ? { status: 0, stdout: `${owner}\n`, stderr: "" }
      : { status: 0, stdout: name, stderr: "" }
  }, name, owner)
  assert.deepEqual(calls[0], [
    "container", "inspect", "--format", `{{ index .Config.Labels "${postgresFixtureOwnerLabel}" }}`, name,
  ])
  assert.deepEqual(calls[1], ["rm", "--force", name])
  for (const stderr of [`Error: No such container: ${name}`, `Error: No such object: ${name}`]) {
    let count = 0
    cleanupOwnedPostgres17Fixture(() => {
      count += 1
      return { status: 1, stdout: "", stderr }
    }, name, owner)
    assert.equal(count, 1)
  }
  for (const inspection of [
    { status: 0, stdout: "different-owner", stderr: "" },
    { status: 0, stdout: "<no value>", stderr: "" },
    { status: 1, stdout: "", stderr: "daemon unavailable" },
    { status: 1, stdout: "", stderr: `Error: No such container: ${name}-other` },
    { status: null, stdout: "", stderr: "", error: new Error("client timeout") },
  ]) {
    const attempted = []
    assert.throws(() => cleanupOwnedPostgres17Fixture((args) => {
      attempted.push(args)
      return inspection
    }, name, owner), assert.AssertionError)
    assert.equal(attempted.length, 1)
    assert.equal(attempted[0][0], "container")
  }
})

test("PostgreSQL 17 transactional preflight named checkpoint preserves FK errors and rollback", {
  skip: process.platform !== "linux",
}, async (t) => {
  const { addNotificationRetirementPreflightCheckpoint } = await import(builderUrl)
  const ownerNonce = randomBytes(12).toString("hex")
  const name = `tips-preflight-postgres17-${process.pid}-${ownerNonce}`
  const invoke = (args, options = {}) => spawnSync("docker", args, {
    encoding: "utf8", timeout: 60_000,
    env: { PATH: process.env.PATH, LANG: "C", LC_ALL: "C" },
    ...options,
  })
  t.after(() => cleanupOwnedPostgres17Fixture(invoke, name, ownerNonce))
  const started = invoke([
    "run", "--rm", "--detach", "--network", "none", "--name", name,
    "--label", `${postgresFixtureOwnerLabel}=${ownerNonce}`,
    "--env", "POSTGRES_PASSWORD=task-local-only", "public.ecr.aws/supabase/postgres:17.6.1.156",
  ])
  assert.equal(started.status, 0, started.stderr)
  const psql = (sql) => invoke([
    "exec", "--interactive", name, "psql", "--quiet", "--tuples-only", "--no-align",
    "--set", "ON_ERROR_STOP=1", "--set", "VERBOSITY=verbose",
    "--username", "supabase_admin", "--dbname", "postgres",
  ], { input: sql })
  let consecutiveReadyChecks = 0
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const pid1 = invoke(["exec", name, "sh", "-c", "tr '\\000' ' ' < /proc/1/cmdline"])
    const isFinalPostgres = pid1.stdout.trim().split(/\s+/u, 1)[0]?.split("/").at(-1) === "postgres"
    const ready = isFinalPostgres ? psql("select 1;") : null
    consecutiveReadyChecks = ready?.status === 0 ? consecutiveReadyChecks + 1 : 0
    if (consecutiveReadyChecks === 3) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert.equal(consecutiveReadyChecks, 3, "isolated PostgreSQL 17 did not become stably ready")
  const version = psql("select current_setting('server_version_num')::integer / 10000;")
  assert.equal(version.status, 0, version.stderr)
  assert.equal(version.stdout.trim(), "17")
  const setup = psql(`
    create schema if not exists dashboard_private;
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations(version text primary key);
    create table dashboard_private.notification_rules(
      id integer primary key, active_template_id integer not null,
      workflow_key text not null, enabled boolean not null
    );
    create table dashboard_private.notification_templates(
      id integer primary key, rule_id integer not null,
      unique(rule_id,id),
      constraint notification_templates_rule_fkey foreign key(rule_id)
        references dashboard_private.notification_rules(id) deferrable initially deferred
    );
    alter table dashboard_private.notification_rules
      add constraint notification_rules_active_template_fkey foreign key(id,active_template_id)
      references dashboard_private.notification_templates(rule_id,id) deferrable initially deferred;
    begin;
    insert into dashboard_private.notification_rules values(1,1,'word_retests',true);
    insert into dashboard_private.notification_templates values(1,1);
    insert into supabase_migrations.schema_migrations(version) values('baseline');
    commit;
  `)
  assert.equal(setup.status, 0, setup.stderr)
  const snapshotSql = `
    select jsonb_build_object(
      'schema', (select jsonb_agg(row_to_json(objects) order by kind,identity) from (
        select 'table' kind, c.oid::regclass::text identity,
          jsonb_build_array(c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) definition
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('dashboard_private','supabase_migrations') and c.relkind='r'
        union all select 'column', a.attrelid::regclass::text||'.'||a.attname,
          jsonb_build_array(a.atttypid,a.attnotnull)
        from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('dashboard_private','supabase_migrations') and a.attnum>0 and not a.attisdropped
        union all select 'constraint', c.conrelid::regclass::text||'.'||c.conname,
          to_jsonb(pg_get_constraintdef(c.oid))
        from pg_constraint c join pg_namespace n on n.oid=c.connamespace
        where n.nspname in ('dashboard_private','supabase_migrations')
        union all select 'trigger', t.tgrelid::regclass::text||'.'||t.tgname,
          to_jsonb(pg_get_triggerdef(t.oid))
        from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('dashboard_private','supabase_migrations')
      ) objects),
      'ledger', (select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
      'rules', (select jsonb_agg(row_to_json(r) order by id) from dashboard_private.notification_rules r),
      'templates', (select jsonb_agg(row_to_json(r) order by id) from dashboard_private.notification_templates r)
    );
  `
  const snapshot = () => {
    const result = psql(snapshotSql)
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  const before = snapshot()
  const update = "update dashboard_private.notification_rules set enabled=false where workflow_key in ('tasks','word_retests') and enabled;"
  const retirementBody = `${update}\n\n${retirementAlter}`
  const currentTransactionRows = `
    begin;
    insert into dashboard_private.notification_rules values(2,2,'word_retests',true);
    insert into dashboard_private.notification_templates values(2,2);
    insert into supabase_migrations.schema_migrations(version) values('candidate');
    set constraints all immediate;
    set constraints all deferred;
  `

  const committedControl = psql(`begin;\n${retirementBody}\nselect 'committed_control_passed';\nrollback;`)
  assert.equal(committedControl.status, 0, committedControl.stderr)
  assert.match(committedControl.stdout, /committed_control_passed/u)
  assert.equal(snapshot(), before)

  const sameTransactionFailure = psql(`${currentTransactionRows}\n${retirementBody}\nselect 'unexpected_ddl_pass';\nrollback;`)
  assert.notEqual(sameTransactionFailure.status, 0)
  assert.match(sameTransactionFailure.stderr, /55006:.*cannot ALTER TABLE "notification_rules" because it has pending trigger events/u)
  assert.doesNotMatch(sameTransactionFailure.stdout, /unexpected_ddl_pass/u)
  assert.equal(snapshot(), before)

  const adaptedBody = addNotificationRetirementPreflightCheckpoint(retirementBody)
  const corrected = psql(`${currentTransactionRows}\n${adaptedBody}\nselect 'named_checkpoint_passed';\nrollback;`)
  assert.equal(corrected.status, 0, corrected.stderr)
  assert.match(corrected.stdout, /named_checkpoint_passed/u)
  assert.equal(snapshot(), before)

  const invalidTemplate = psql(`${currentTransactionRows}
    update dashboard_private.notification_rules set active_template_id=999 where id=2;
    ${adaptedBody}
    select 'unexpected_invalid_fk_pass';
    rollback;
  `)
  assert.notEqual(invalidTemplate.status, 0)
  assert.match(invalidTemplate.stderr, /23503:.*violates foreign key constraint "notification_rules_active_template_fkey"/u)
  assert.doesNotMatch(invalidTemplate.stdout, /unexpected_invalid_fk_pass/u)
  assert.equal(snapshot(), before)
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

test("agent release permits exact reviewed migrations behind production, rejects drift, and skips applied files", async () => {
  const { buildTransactionalPreflightSql } = await import(builderUrl)
  const { root } = await createFixture()
  const files = [
    "20260929110109_agent_api_scoped_schedule.sql",
    "20260929113744_agent_api_audit_history_decoupling.sql",
    "20260929130122_agent_api_class_changes.sql",
    "20260929132914_agent_legacy_dated_override.sql",
  ]
  const sources = await Promise.all(files.map(file => readFile(join(repoRoot, "supabase/migrations", file), "utf8")))
  for (const [index, file] of files.entries()) await writeFile(join(root, "supabase/migrations", file), sources[index])
  const rows = ["20260820150057", "20260820152710", "20260820160000", "20260929154143"]
    .map(version => ({ local: version, remote: version, time: "now" }))
  rows.push(...files.map(file => ({ local: file.slice(0, 14), remote: "", time: "now" })))
  const build = () => buildTransactionalPreflightSql({
    repoRoot: root,
    migrationLedger: JSON.stringify({ message: "Migrations listed", migrations: rows }),
    forwardMigrationsPath: "supabase/migrations",
    focusedTestPath: "supabase/tests/focused.sql",
  })
  const result = await build()
  assert.deepEqual(result.pendingFiles, files)
  assert.deepEqual(result.interleavedPendingVersions, files.map(file => file.slice(0, 14)))
  assert.equal((result.sql.match(/^begin;$/gim) ?? []).length, 1)
  assert.equal((result.sql.match(/^commit;$/gim) ?? []).length, 0)
  assert.match(result.sql.trimEnd(), /rollback;$/i)
  for (const [index, file] of files.entries()) {
    await writeFile(join(root, "supabase/migrations", file), sources[index] + "\n-- drift\n")
    await assert.rejects(build(), { message: "transactional_preflight_interleaved_hash_mismatch" })
    await writeFile(join(root, "supabase/migrations", file), sources[index])
  }
  for (const row of rows) row.remote = row.local
  const applied = await build()
  assert.deepEqual(applied.pendingFiles, [])
  assert.doesNotMatch(applied.sql, /transactional preflight migration/)
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


test("the actual calendar suite is a deployment-compatible rollback envelope", async () => {
  const { buildTransactionalPreflightSql } = await import(builderUrl)
  const focusedSource = await readFile(join(repoRoot, "supabase/tests/agent_management_calendar_test.sql"), "utf8")
  const { root, ledger } = await createFixture({ focusedSource })
  const result = await buildTransactionalPreflightSql({
    repoRoot: root, migrationLedger: ledger,
    forwardMigrationsPath: "supabase/migrations", focusedTestPath: "supabase/tests/focused.sql",
  })
  for (const marker of ["set local role postgres;", "pending_first_marker", "pending_second_marker", "select no_plan();"]) {
    assert.ok(result.sql.indexOf(marker) >= 0, `required marker: ${marker}`)
  }
  assert.ok(result.sql.indexOf("set local role postgres;") < result.sql.indexOf("pending_first_marker"))
  assert.ok(result.sql.indexOf("pending_second_marker") < result.sql.indexOf("select no_plan();"))
  assert.match(result.sql, /v2 rejects nonexistent selected class/)
  assert.equal((result.sql.match(/^begin;$/gim) ?? []).length, 1)
  assert.equal((result.sql.match(/^commit;$/gim) ?? []).length, 0)
  assert.equal((result.sql.match(/^rollback;$/gim) ?? []).length, 1)
})
