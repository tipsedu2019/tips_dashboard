import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import test from "node:test"

const fixtureModuleUrl = new URL(
  "../scripts/notification-content-local-qa-fixture.mjs",
  import.meta.url,
)
const fixtureSqlUrl = new URL(
  "../supabase/tests/fixtures/notification_content_local_qa_fixture.sql",
  import.meta.url,
)
const coverageManifestUrl = new URL(
  "./fixtures/notification-content-coverage-manifest.json",
  import.meta.url,
)
const runnerUrl = new URL("../scripts/run-notification-isolated-db-qa.mjs", import.meta.url)
const evidenceUrl = new URL("../scripts/notification-content-db-evidence.mjs", import.meta.url)
const runtimePgTapUrl = new URL(
  "../supabase/tests/notification_control_plane_runtime_test.sql",
  import.meta.url,
)
const schemaPgTapUrl = new URL(
  "../supabase/tests/notification_control_plane_schema_test.sql",
  import.meta.url,
)
const makeupPgTapUrl = new URL(
  "../supabase/tests/notification_makeup_adapter_test.sql",
  import.meta.url,
)
const contentPgTapUrl = new URL(
  "../supabase/tests/notification_content_contract_test.sql",
  import.meta.url,
)

const expectedPgTapFiles = Object.freeze([
  "supabase/tests/notification_control_plane_schema_test.sql",
  "supabase/tests/notification_adapters_forward_install_test.sql",
  "supabase/tests/notification_content_contract_test.sql",
  "supabase/tests/notification_delivery_pending_schedule_test.sql",
  "supabase/tests/notification_makeup_single_writer_test.sql",
  "supabase/tests/notification_control_plane_runtime_test.sql",
  "supabase/tests/notification_ops_task_adapters_test.sql",
  "supabase/tests/notification_registration_handoffs_test.sql",
  "supabase/tests/notification_transfer_withdrawal_adapters_test.sql",
  "supabase/tests/notification_makeup_adapter_test.sql",
  "supabase/tests/notification_approval_adapter_test.sql",
  "supabase/tests/notification_system_template_vnext_test.sql",
  "supabase/tests/notification_worker_production_schedule_test.sql",
])

async function loadSubject() {
  return import(fixtureModuleUrl.href)
}

test("합성 fixture manifest는 현재 188개 설정 graph와 고정 identity를 잠근다", async () => {
  const { loadNotificationContentLocalQaContract } = await loadSubject()
  const contract = await loadNotificationContentLocalQaContract()

  assert.deepEqual(Object.keys(contract.manifest).sort(), [
    "expectedCounts",
    "identities",
    "sqlSha256",
    "version",
  ])
  assert.equal(contract.manifest.version, 1)
  assert.match(contract.manifest.sqlSha256, /^[a-f0-9]{64}$/u)
  assert.deepEqual(contract.manifest.expectedCounts, {
    authUsers: 1,
    profiles: 1,
    workflows: 7,
    eventKeys: 51,
    settingsRegistry: 188,
    rules: 189,
    historicalTemplates: 189,
    vNextTemplates: 188,
    templates: 377,
    contentContracts: 188,
    complianceAudits: 188,
    legacySettings: 42,
    importMetadata: 42,
    runtimeFlags: 12,
    reminderApplicability: 4,
    operationalRows: 0,
  })
  assert.equal(contract.manifest.identities.namespace, "notification-content-local-qa-v1")
  assert.equal(
    contract.manifest.identities.actor.email,
    "notification-content-local-qa@runtime.invalid",
  )
  assert.equal(
    contract.manifest.identities.actor.userId,
    contract.manifest.identities.actor.profileId,
  )
  assert.equal(
    contract.manifest.identities.actor.userId,
    "31500000-0000-4000-8000-000000000001",
  )
  assert.equal(contract.manifest.identities.configuration.count, 188)
  assert.equal(
    contract.manifest.identities.configuration.sha256,
    "2b09a1c44db7beb0c67b7bce13baf931e7c91677d423cdb0247acd7a1d50a178",
  )
  assert.deepEqual(contract.manifest.identities.configuration.byWorkflow, {
    approvals: 36,
    makeup_requests: 32,
    registration: 26,
    tasks: 40,
    transfer: 2,
    withdrawal: 2,
    word_retests: 50,
  })
  assert.deepEqual(contract.manifest.identities.configuration.ruleByWorkflow, {
    approvals: 36,
    makeup_requests: 32,
    registration: 27,
    tasks: 40,
    transfer: 2,
    withdrawal: 2,
    word_retests: 50,
  })
  assert.equal(contract.manifest.identities.roundTrip.workflowKey, "tasks")
  assert.equal(contract.manifest.identities.roundTrip.eventKey, "task.created")
  assert.equal(contract.manifest.identities.roundTrip.audienceKey, "requester_profile")
  assert.equal(contract.manifest.identities.roundTrip.channelKey, "in_app")
  assert.equal(contract.manifest.identities.roundTrip.ruleVariantKey, "immediate")
  assert.equal(
    contract.manifest.identities.roundTrip.ruleId,
    "08c5fd0c-36bb-5798-869a-1f9ff46a902a",
  )
  assert.equal(
    contract.manifest.identities.roundTrip.activeTemplateId,
    "222914cb-f640-55b9-862c-0343f547480d",
  )
  assert.equal(Object.isFrozen(contract), true)
  assert.equal(Object.isFrozen(contract.manifest), true)
  assert.equal(Object.isFrozen(contract.manifest.expectedCounts), true)
  assert.equal(Object.isFrozen(contract.manifest.identities), true)
})

test("pgTAP 계약은 review된 13개 파일의 순서와 실제 SHA-256만 허용한다", async () => {
  const { loadNotificationContentLocalQaContract } = await loadSubject()
  const contract = await loadNotificationContentLocalQaContract()

  assert.deepEqual(contract.pgTap.files.map((entry) => entry.relativePath), expectedPgTapFiles)
  assert.equal(contract.pgTap.fileCount, 13)
  assert.equal(new Set(contract.pgTap.files.map((entry) => entry.relativePath)).size, 13)
  assert.equal(contract.pgTap.files.every((entry) => /^[a-f0-9]{64}$/u.test(entry.sha256)), true)
  assert.match(contract.pgTap.sha256, /^[a-f0-9]{64}$/u)
  assert.equal(Object.isFrozen(contract.pgTap), true)
  assert.equal(Object.isFrozen(contract.pgTap.files), true)
  assert.equal(contract.pgTap.files.every(Object.isFrozen), true)
  assert.equal(
    contract.pgTap.files.at(-1).relativePath,
    "supabase/tests/notification_worker_production_schedule_test.sql",
  )
  assert.equal(contract.pgTap.files.some((entry) => /pending-migrations|quarantine/u.test(entry.relativePath)), false)
})

test("fixture SQL은 schema-only DB에 합성 설정만 설치하고 operational row와 secret을 거부한다", async () => {
  const [{ assertNotificationContentLocalQaFixtureSql }, sql, coverageManifest] = await Promise.all([
    loadSubject(),
    readFile(fixtureSqlUrl, "utf8"),
    readFile(coverageManifestUrl, "utf8").then(JSON.parse),
  ])

  assert.doesNotThrow(() => assertNotificationContentLocalQaFixtureSql(sql))
  assert.match(sql, /^begin;/u)
  assert.match(sql, /notification_content_local_qa_preflight_begin/u)
  assert.match(sql, /notification_content_local_qa_install_begin/u)
  assert.match(sql, /notification_content_local_qa_verify_begin/u)
  assert.match(sql, /notification-content-local-qa@runtime\.invalid/u)
  assert.match(sql, /notification_content_local_qa_rule_groups_begin/u)
  const embeddedCoverage = sql.match(
    /-- notification_content_local_qa_rule_groups_json_begin\n\$notification_content_local_qa_rule_groups\$\n(?<json>\{[\s\S]*?\})\n\$notification_content_local_qa_rule_groups\$::jsonb\n-- notification_content_local_qa_rule_groups_json_end/u,
  )
  assert.ok(embeddedCoverage?.groups?.json)
  assert.deepEqual(JSON.parse(embeddedCoverage.groups.json), coverageManifest)
  assert.match(sql, /notification_system_template_vnext_payload_v1/u)
  assert.match(sql, /install_notification_system_templates_vnext_v1/u)
  assert.match(sql, /notification_template_compliance_v1/u)
  assert.match(sql, /notification_content_local_qa_fixture/u)
  assert.match(sql, /commit;\s*$/u)
  assert.doesNotMatch(sql, /https?:\/\/|www\.|supabase\.co|chat\.googleapis\.com/iu)
  assert.doesNotMatch(sql, /\b(?:sbp|sb_secret|sb_publishable)_[A-Za-z0-9_-]+/u)
  assert.doesNotMatch(sql, /\b01(?:0|1|6|7|8|9)[- ]?\d{3,4}[- ]?\d{4}\b/u)
  assert.doesNotMatch(
    sql,
    /insert\s+into\s+(?:public\.(?:students|classes|dashboard_notifications|google_chat_webhook_settings|makeup_notification_deliveries)|dashboard_private\.(?:notification_events|notification_deliveries|notification_dispatch_ownership_claims))/iu,
  )
})

test("fixture source review는 실제 도메인·연락처·URL·provider secret·업무 row를 fail-closed로 거부한다", async () => {
  const { assertNotificationContentLocalQaFixtureSql } = await loadSubject()
  const sql = await readFile(fixtureSqlUrl, "utf8")
  const unsafeVariants = [
    `${sql}\n-- qa@example.com`,
    `${sql}\n-- 010-1234-5678`,
    `${sql}\n-- https://example.com/path`,
    `${sql}\n-- sbp_not-a-real-token`,
    `${sql}\ninsert into public.students(id) values (gen_random_uuid());`,
    `${sql}\ninsert into public.google_chat_webhook_settings(channel) values ('admin');`,
    sql.replace(
      "notification-content-local-qa@runtime.invalid",
      "notification-content-local-qa@example.com",
    ),
  ]

  for (const candidate of unsafeVariants) {
    assert.throws(
      () => assertNotificationContentLocalQaFixtureSql(candidate),
      /notification_local_db_fixture_source_refused/u,
    )
  }
})

test("round-trip SQL은 settings UI flag만 임시 true로 만들고 false 복구와 rollback을 분리한다", async () => {
  const evidence = await readFile(evidenceUrl, "utf8")
  const roundTripStart = evidence.indexOf("function roundTripSql()")
  const readOnlyStart = evidence.indexOf("function readOnlySql()")
  assert.ok(roundTripStart >= 0 && readOnlyStart > roundTripStart)
  const roundTrip = evidence.slice(roundTripStart, readOnlyStart)

  assert.match(
    roundTrip,
    /update dashboard_private\.notification_runtime_flags\s+set enabled = true\s+where flag_key = 'notification_control_plane_settings_ui_enabled'/u,
  )
  assert.match(
    roundTrip,
    /update dashboard_private\.notification_runtime_flags\s+set enabled = false\s+where flag_key = 'notification_control_plane_settings_ui_enabled'/u,
  )
  assert.match(roundTrip, /not exists \(\s*select 1 from dashboard_private\.notification_runtime_flags where enabled\s*\)/u)
  assert.match(roundTrip, /rollback;\s*`/u)
  assert.doesNotMatch(
    roundTrip,
    /set enabled = true\s+where flag_key = 'notification_control_plane_(?:shadow|dispatch|registration_)/u,
  )
})

test("allowlist pgTAP은 최신 188 identity와 single-writer/vNext 상태를 서로 모순 없이 검증한다", async () => {
  const [runtime, schema, makeup, content] = await Promise.all([
    readFile(runtimePgTapUrl, "utf8"),
    readFile(schemaPgTapUrl, "utf8"),
    readFile(makeupPgTapUrl, "utf8"),
    readFile(contentPgTapUrl, "utf8"),
  ])

  assert.match(runtime, /188::bigint/u)
  assert.doesNotMatch(runtime, /165::bigint/u)
  assert.match(runtime, /registration\.appointment_reminder_due/u)
  assert.match(runtime, /registration\.visit_subject_deselected/u)
  assert.doesNotMatch(
    runtime,
    /values \(1, dashboard_private\.notification_seed_workflow_settings_v1\(\)\)/u,
  )
  assert.match(schema, /not pg_catalog\.has_table_privilege\(\s*'authenticated',\s*'public\.makeup_notification_settings',\s*'INSERT'/u)
  assert.match(schema, /not pg_catalog\.has_table_privilege\(\s*'authenticated',\s*'public\.makeup_notification_settings',\s*'UPDATE'/u)
  assert.match(schema, /not pg_catalog\.has_table_privilege\(\s*'authenticated',\s*'public\.makeup_notification_settings',\s*'DELETE'/u)
  assert.match(makeup, /hasnt_trigger\(\s*'public',\s*'makeup_notification_settings'/u)
  assert.match(makeup, /authenticated direct legacy setting writers remain closed/u)
  assert.match(content, /one reviewed vNext template exists for every content contract/u)
  assert.doesNotMatch(
    content,
    /where template_row\.content_contract_version is not null\s*\$\$, 'migration preserves all historical template snapshot bytes and contract nullability'/u,
  )
})

test("isolated DB runner plan은 fixture count와 exact pgTAP 13개를 출력하지만 실행은 계속 닫힌다", async () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", runnerUrl.pathname], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  })

  assert.equal(result.status, 0, result.stderr)
  const plan = JSON.parse(result.stdout)
  assert.equal(plan.mode, "plan")
  assert.equal(plan.expectedResources.syntheticFixture.settingsRegistry, 188)
  assert.equal(plan.expectedResources.syntheticFixture.rules, 189)
  assert.equal(plan.expectedResources.syntheticFixture.operationalRows, 0)
  assert.equal(plan.expectedResources.pgTapFileCount, 13)
  assert.deepEqual(plan.expectedResources.pgTapFiles, expectedPgTapFiles)
  assert.equal(plan.expectedResources.providerEgressBlocked, true)
  assert.equal(plan.expectedResources.productionRowDataCopied, 0)
  assert.equal(plan.expectedResources.productionMutationCount, 0)
})
