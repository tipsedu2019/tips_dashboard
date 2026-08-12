import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import os from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

import { createOwnedProviderZeroProject } from "../scripts/run-registration-observation-google-chat-provider-zero.mjs"

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const migrationDirectory = join(repositoryRoot, "supabase", "migrations")

async function readForwardMigration() {
  const paths = (await readdir(migrationDirectory))
    .filter((entry) => /^[0-9]{14}_notification_adapters_forward_install\.sql$/u.test(entry))
    .sort()

  assert.equal(
    paths.length,
    1,
    "the forward adapter package must be one CLI-generated active migration",
  )
  assert.match(paths[0], /^[0-9]{14}_notification_adapters_forward_install\.sql$/u)
  return {
    file: paths[0],
    source: await readFile(join(migrationDirectory, paths[0]), "utf8"),
  }
}

function safeLocalEnvironment() {
  return {
    HOME: process.env.HOME ?? "/tmp",
    LANG: process.env.LANG ?? "C",
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    SHELL: process.env.SHELL ?? "/bin/zsh",
    TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
    USER: process.env.USER ?? "notification-adapters-forward-install-test",
  }
}

async function capturePassivePreflightState(project) {
  const { stdout } = await project.execSql(`
    select pg_catalog.jsonb_build_object(
      'flags', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'key', flag_row.flag_key,
            'enabled', flag_row.enabled,
            'revision', flag_row.revision
          ) order by flag_row.flag_key
        )
        from dashboard_private.notification_runtime_flags flag_row
      ), '[]'::jsonb),
      'rules', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', rule_row.id,
            'enabled', rule_row.enabled,
            'revision', rule_row.revision,
            'templateId', rule_row.active_template_id
          ) order by rule_row.id
        )
        from dashboard_private.notification_rules rule_row
      ), '[]'::jsonb)
    )::text;
  `)
  return JSON.parse(String(stdout).trim())
}

async function scalarSql(project, sql) {
  const { stdout } = await project.execSql(sql)
  return String(stdout).trim()
}

function sourceBlock(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `missing source block: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `missing source block terminator: ${end}`)
  return source.slice(startIndex, endIndex)
}

test("forward adapter migration installs only the passive ownership ABI", async () => {
  // Break caught: omitting any ABI object leaves active lifecycle code with a
  // marker that claims readiness even though dispatch ownership cannot resolve.
  const { source } = await readForwardMigration()

  assert.match(source, /^begin;\s*/i)
  assert.match(source, /commit;\s*$/i)
  assert.match(source, /create\s+table\s+dashboard_private\.notification_cutover_owners\b/i)
  assert.match(
    source,
    /create\s+or\s+replace\s+function\s+dashboard_private\.notification_dispatch_scope_for_event_v1\s*\(\s*p_workflow_key\s+text\s*,\s*p_event_key\s+text\s*\)/i,
  )
  assert.match(
    source,
    /create\s+or\s+replace\s+function\s+public\.notification_workflow_adapters_runtime_version\s*\(\s*\)/i,
  )
  assert.ok(
    source.lastIndexOf("notification_workflow_adapters_runtime_version")
      > source.indexOf("notification_cutover_owners"),
    "the capability marker must follow ownership ABI installation",
  )

  for (const tuple of [
    "('tasks', 'tasks', 'notification_control_plane_dispatch_tasks_enabled', 'legacy')",
    "('word_retests', 'word_retests', 'notification_control_plane_dispatch_word_retests_enabled', 'legacy')",
    "('approvals', 'approvals', 'notification_control_plane_dispatch_approvals_enabled', 'legacy')",
    "('transfer', 'transfer', 'notification_control_plane_dispatch_transfer_enabled', 'legacy')",
    "('withdrawal', 'withdrawal', 'notification_control_plane_dispatch_withdrawal_enabled', 'legacy')",
    "('makeup_requests', 'makeup_requests', 'notification_control_plane_dispatch_makeup_requests_enabled', 'legacy')",
    "('registration', 'registration', 'notification_control_plane_dispatch_registration_enabled', 'legacy')",
    "('registration_phone', 'registration', 'notification_control_plane_registration_phone_adapter_enabled', 'legacy')",
    "('registration_visit', 'registration', 'notification_control_plane_registration_visit_adapter_enabled', 'legacy')",
    "('registration_solapi', 'registration', 'notification_control_plane_registration_solapi_adapter_enabled', 'legacy')",
  ]) {
    assert.ok(source.includes(tuple), `missing exact legacy owner tuple: ${tuple}`)
  }
  assert.match(
    source,
    /p_event_key\s*=\s*'registration\.phone_consultation_ready'[\s\S]*?then\s+'registration_phone'/i,
  )
})

test("forward adapter migration is passive and cannot install an external execution path", async () => {
  // Break caught: changing this installation into an activation or sender path
  // would make a local capability migration capable of external delivery.
  const { source } = await readForwardMigration()

  assert.doesNotMatch(source, /\b(?:cron\.schedule|net\.http|pg_net|vault|webhook|provider|directory)\b/i)
  assert.doesNotMatch(source, /\bupdate\s+dashboard_private\.notification_runtime_flags\b/i)
  assert.doesNotMatch(source, /\benabled\s*=\s*true\b/i)
  assert.doesNotMatch(source, /\b(?:manage_notification_worker_schedule_v1|activate_notification_dispatch_cutover_v1)\b/i)
  assert.doesNotMatch(
    source,
    /\b(?:insert\s+into|update|delete\s+from)\s+dashboard_private\.notification_(?:events|deliveries|rules|templates|connections)\b/i,
  )
  assert.doesNotMatch(
    source,
    /grant\s+select\s+on\s+table\s+dashboard_private\.notification_cutover_owners[\s\S]*?\bauthenticated\b/i,
  )
})

test("forward adapter migration keeps private ABI closed and exposes only the passive marker", async () => {
  // Break caught: granting a private resolver/table to an API role turns a
  // dispatch-routing compatibility layer into a public data endpoint.
  const { source } = await readForwardMigration()

  assert.match(source, /alter\s+table\s+dashboard_private\.notification_cutover_owners\s+enable\s+row\s+level\s+security/i)
  assert.match(
    source,
    /revoke\s+all\s+on\s+function\s+dashboard_private\.notification_dispatch_scope_for_event_v1\s*\(\s*text\s*,\s*text\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i,
  )
  assert.match(
    source,
    /revoke\s+all\s+on\s+function\s+public\.notification_workflow_adapters_runtime_version\s*\(\s*\)\s+from\s+public\s*,\s*anon/i,
  )
  assert.match(
    source,
    /grant\s+execute\s+on\s+function\s+public\.notification_workflow_adapters_runtime_version\s*\(\s*\)\s+to\s+authenticated\s*,\s*service_role/i,
  )

  const resolver = sourceBlock(
    source,
    "create or replace function dashboard_private.notification_dispatch_scope_for_event_v1",
    "alter function dashboard_private.notification_dispatch_scope_for_event_v1",
  )
  assert.match(resolver, /security\s+definer/i)
  assert.match(resolver, /set\s+search_path\s*=\s*''/i)

  const marker = sourceBlock(
    source,
    "create or replace function public.notification_workflow_adapters_runtime_version",
    "alter function public.notification_workflow_adapters_runtime_version",
  )
  assert.match(marker, /security\s+invoker/i)
  assert.match(marker, /set\s+search_path\s*=\s*''/i)
  assert.match(marker, /as\s+\$\$\s*select\s+1\s*;\s*\$\$/i)
})

test("forward migration fails before changing flags or rules when an owner table or marker already exists", async () => {
  // Break caught: replacing a collision with an upsert or marker rewrite would
  // make a passive forward install mutate a pre-existing runtime contract.
  const { file: migrationFile, source: migrationSource } = await readForwardMigration()
  const project = await createOwnedProviderZeroProject({
    repositoryRoot,
    env: safeLocalEnvironment(),
  })

  try {
    await project.applyMigrationsThrough("20260809105000")
    const beforeOwnerConflict = await capturePassivePreflightState(project)
    await project.execSql(`
      create table dashboard_private.notification_cutover_owners(
        scope_key text primary key
      );
      insert into dashboard_private.notification_cutover_owners(scope_key)
      values ('existing-owner-row');
    `)
    await assert.rejects(
      project.execSql(migrationSource),
      /notification_adapters_forward_install_preflight_failed/,
    )
    assert.deepEqual(await capturePassivePreflightState(project), beforeOwnerConflict)
    assert.equal(
      await scalarSql(project, "select pg_catalog.count(*) from dashboard_private.notification_cutover_owners;"),
      "1",
    )
    assert.equal(
      await scalarSql(project, "select pg_catalog.to_regprocedure('public.notification_workflow_adapters_runtime_version()') is null;"),
      "t",
    )

    await project.resetMigrationBaseline()
    const beforeMarkerConflict = await capturePassivePreflightState(project)
    await project.execSql(`
      create function public.notification_workflow_adapters_runtime_version()
      returns integer
      language sql
      as $$ select 0; $$;
      grant execute on function public.notification_workflow_adapters_runtime_version() to anon;
    `)
    assert.equal(
      await scalarSql(project, "select has_function_privilege('anon', 'public.notification_workflow_adapters_runtime_version()', 'execute');"),
      "t",
    )
    await assert.rejects(
      project.execSql(migrationSource),
      /notification_adapters_forward_install_preflight_failed/,
    )
    assert.deepEqual(await capturePassivePreflightState(project), beforeMarkerConflict)
    assert.equal(
      await scalarSql(project, "select pg_catalog.to_regclass('dashboard_private.notification_cutover_owners') is null;"),
      "t",
    )

    await project.resetMigrationBaseline()
    const beforeValidInstall = await capturePassivePreflightState(project)
    await project.applyForwardMigration(
      join(migrationDirectory, migrationFile),
      "supabase/tests/notification_adapters_forward_install_test.sql",
    )
    assert.deepEqual(
      await capturePassivePreflightState(project),
      beforeValidInstall,
      "the real forward apply must leave every existing flag and rule byte-equivalent",
    )
  } finally {
    await project.cleanupOwnedResources()
  }
})
