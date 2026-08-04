import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const fixtureUrl = new URL("./fixtures/notification-content-golden.json", import.meta.url)
const migrationUrl = new URL(
  "../supabase/migrations/20260803152000_notification_system_templates_vnext.sql",
  import.meta.url,
)
const promotionMigrationUrl = new URL(
  "../supabase/migrations/20260805100000_notification_system_template_vnext_promotion.sql",
  import.meta.url,
)
const pgTapUrl = new URL(
  "../supabase/tests/notification_system_template_vnext_test.sql",
  import.meta.url,
)
const contractsUrl = new URL(
  "../src/features/notifications/notification-content-contract-registry.ts",
  import.meta.url,
)

const identityKey = ({ workflowKey, eventKey, audienceKey, channelKey, ruleVariantKey }) =>
  [workflowKey, eventKey, audienceKey, channelKey, ruleVariantKey].join("|")

async function loadFixture() {
  return JSON.parse(await readFile(fixtureUrl, "utf8"))
}

async function loadMigration() {
  return readFile(migrationUrl, "utf8")
}

async function loadPromotionMigration() {
  return readFile(promotionMigrationUrl, "utf8")
}

function render(template, payload) {
  const rendered = template.replace(/\{([a-z][a-z0-9_]*)\}/gu, (_, key) => {
    assert.ok(Object.hasOwn(payload, key), `representative payload is missing ${key}`)
    return payload[key]
  })
  return rendered
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line !== "" || (index > 0 && lines[index - 1] !== ""))
    .join("\n")
    .trim()
}

function embeddedEventTemplates(migration) {
  const match = migration.match(
    /notification_system_template_vnext_fixture_begin\s*\$notification_system_templates\$([\s\S]*?)\$notification_system_templates\$\s*::jsonb\s*-- notification_system_template_vnext_fixture_end/u,
  )
  assert.ok(match, "migration must embed the reviewed event template fixture")
  return JSON.parse(match[1])
}

function functionBlock(source, qualifiedName) {
  const escaped = qualifiedName.replaceAll(".", "\\.")
  const match = source.match(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+${escaped}\\([\\s\\S]*?\\n\\$\\$;`,
    "iu",
  ))
  assert.ok(match, `missing function ${qualifiedName}`)
  return match[0]
}

test("golden fixture resolves an exact self-contained message for every registry-derived rule identity", async () => {
  const [{ listNotificationContentContracts }, fixture] = await Promise.all([
    import(contractsUrl.href),
    loadFixture(),
  ])
  const contracts = listNotificationContentContracts()
  const expectedIdentities = new Set(contracts.map(identityKey))
  const actualIdentities = new Set(fixture.ruleIdentities.map(identityKey))

  assert.equal(fixture.schemaVersion, 1)
  assert.equal(fixture.contractVersion, "1")
  assert.equal(fixture.eventGoldens.length, 48)
  assert.equal(fixture.ruleIdentities.length, contracts.length)
  assert.equal(actualIdentities.size, fixture.ruleIdentities.length)
  assert.deepEqual([...actualIdentities].sort(), [...expectedIdentities].sort())

  const goldenByEvent = new Map(fixture.eventGoldens.map((entry) => [entry.eventKey, entry]))
  for (const identity of fixture.ruleIdentities) {
    const golden = goldenByEvent.get(identity.goldenEventKey)
    assert.ok(golden, `missing golden for ${identityKey(identity)}`)
    assert.equal(golden.workflowKey, identity.workflowKey)
    assert.equal(golden.eventKey, identity.eventKey)
    assert.equal(render(golden.titleTemplate, golden.representativePayload), golden.expectedTitle)
    assert.equal(render(golden.bodyTemplate, golden.representativePayload), golden.expectedBody)
    assert.match(golden.expectedTitle, /^\p{Extended_Pictographic}\uFE0F? \[[^\]\n]+\] .+/u)
    assert.match(golden.expectedBody, /^\[[^\]\n]+\] /u)
    assert.doesNotMatch(`${golden.titleTemplate}\n${golden.bodyTemplate}`, /deep_link|https?:\/\/|\/admin\//iu)
    assert.doesNotMatch(
      `${golden.expectedTitle}\n${golden.expectedBody}`,
      /\[다음\]|확인해\s*주세요|처리해\s*주세요|클릭해\s*주세요|\bnull\b|[0-9a-f]{8}-[0-9a-f-]{27,}/iu,
    )
  }
})

test("fixture keeps the three approved representative messages byte-exact", async () => {
  const fixture = await loadFixture()
  assert.deepEqual(fixture.requiredExamples, [
    {
      key: "task_due_changed",
      title: "🔄 [할 일] 박지훈 학생 교재 주문 마감일이 바뀌었어요",
      body: "[업무] 2학기 수학 교재 주문\n[변경] 8월 5일(수) → 8월 7일(금)\n[진행] 관리팀의 변경 일정 확인을 기다리고 있어요.",
    },
    {
      key: "word_retest_passed",
      title: "✅ [단어 재시험] 이서연 학생이 재시험을 통과했어요",
      body: "[수업] 중2 영어 A반\n[시험] Lesson 12 · 50문항\n[결과] 46점 / 통과 기준 45점 · 통과\n[상태] 재시험 결과가 기록됐어요.",
    },
    {
      key: "approval_submitted",
      title: "📥 [전자결재] 7월 교재비 정산서가 제출됐어요",
      body: "[문서] 7월 교재비 정산 · 작성자 박지영\n[기간] 2026년 7월\n[진행] 김철수님의 결재를 기다리고 있어요.",
    },
  ])
})

test("migration installs one deterministic append-only system template from the latest contract", async () => {
  const [fixture, migration] = await Promise.all([loadFixture(), loadMigration()])
  const embedded = embeddedEventTemplates(migration)
  assert.deepEqual(
    embedded,
    fixture.eventGoldens.map(({ workflowKey, eventKey, titleTemplate, bodyTemplate }) => ({
      workflowKey,
      eventKey,
      titleTemplate,
      bodyTemplate,
    })),
  )

  const install = functionBlock(
    migration,
    "dashboard_private.install_notification_system_templates_vnext_v1",
  )
  assert.match(install, /insert\s+into\s+dashboard_private\.notification_templates/iu)
  assert.match(install, /notification_deterministic_uuid_v1\([\s\S]*notification-template-vnext-v1/iu)
  assert.match(install, /notification_seed_template_checksum_v1\(/iu)
  assert.match(install, /contract_row\.contract_json\s*->\s*'availableVariables'/iu)
  assert.match(install, /contract_row\.contract_version/iu)
  assert.match(install, /created_actor_kind[\s\S]*'system'/iu)
  assert.match(install, /on\s+conflict\s*\(id\)\s+do\s+nothing/iu)
  assert.doesNotMatch(install, /\bupdate\s+dashboard_private\.notification_(?:rules|templates)/iu)
  assert.doesNotMatch(install, /\bdelete\s+from\s+dashboard_private\.notification_templates/iu)
  assert.doesNotMatch(install, /\bactive_template_id\s*=/iu)
})

test("vNext promotion changes only active system defaults and preserves custom templates", async () => {
  const promotion = await loadPromotionMigration()

  assert.match(promotion, /^begin;[\s\S]*commit;\s*$/u)
  assert.match(promotion, /notification_system_template_vnext_baseline_missing/iu)
  assert.match(promotion, /active_template\.created_by is null/iu)
  assert.match(promotion, /active_template\.created_actor_kind = 'system'/iu)
  assert.match(promotion, /notification-template-vnext-v1/iu)
  assert.match(promotion, /update\s+dashboard_private\.notification_rules/iu)
  assert.match(promotion, /active_template_id = eligible\.next_template_id/iu)
  assert.match(promotion, /revision = rule_row\.revision \+ 1/iu)
  assert.match(promotion, /updated_actor_kind = 'system'/iu)
  assert.match(promotion, /notification_template_compliance_v1/iu)
  assert.match(promotion, /user_custom_templates_preserved/iu)
  assert.doesNotMatch(
    promotion,
    /notification_(?:deliveries|dispatch_ownership_claims|rule_reconciliation_jobs|target_reconciliation_jobs)|dashboard_notifications|makeup_notification_deliveries|webhook|https?:\/\//iu,
  )
})

test("service-role audit is idempotent, safe, and does not expose activation or delivery side effects", async () => {
  const migration = await loadMigration()
  const audit = functionBlock(migration, "public.audit_notification_content_templates_v1")

  assert.match(audit, /coalesce\(\(select auth\.role\(\)\), ''\)\s*<>\s*'service_role'/iu)
  assert.match(audit, /notification_service_role_required/iu)
  assert.match(audit, /notification_template_compliance_audits/iu)
  assert.match(audit, /on\s+conflict\s+do\s+nothing/iu)
  for (const comparison of [
    "created_actor_kind",
    "approved_baseline_template_id",
    "title_template",
    "body_template",
    "allowed_variables",
    "payload_schema_version",
    "content_contract_version",
    "checksum",
  ]) {
    assert.match(audit, new RegExp(comparison, "iu"), `audit must compare ${comparison}`)
  }
  assert.match(audit, /'conformant'/u)
  assert.match(audit, /'legacy_custom_nonconformant'/u)
  assert.match(audit, /workflow_label[\s\S]*event_label[\s\S]*channel_label[\s\S]*audience_label[\s\S]*rule_variant_label/iu)
  assert.doesNotMatch(audit, /jsonb_build_object\([\s\S]*'(?:rule_id|template_id|checksum|title_template|body_template)'/iu)

  assert.match(migration, /revoke all on function public\.audit_notification_content_templates_v1\(text, uuid\)[\s\S]*from public, anon, authenticated, service_role/iu)
  assert.match(migration, /grant execute on function public\.audit_notification_content_templates_v1\(text, uuid\)\s+to service_role/iu)
  assert.doesNotMatch(migration, /create\s+(?:or\s+replace\s+)?function\s+public\.(?:activate|rollback|release)_notification/iu)
  assert.doesNotMatch(migration, /insert\s+into\s+dashboard_private\.notification_(?:deliveries|rule_reconciliation_jobs|target_reconciliation_jobs)/iu)
  assert.doesNotMatch(migration, /insert\s+into\s+public\.dashboard_notifications/iu)
  assert.doesNotMatch(migration, /https?:\/\/|webhook/iu)
})

test("pgTAP keeps audit calls isolated and proves custom and operational-state protection", async () => {
  const pgTap = await readFile(pgTapUrl, "utf8")

  assert.match(pgTap, /^begin;/u)
  assert.match(pgTap, /select \* from finish\(\);\s*rollback;/u)
  assert.doesNotMatch(pgTap, /\b185\b/u)
  assert.match(
    pgTap,
    /count\(\*\)[\s\S]*notification_templates[\s\S]*count\(\*\)[\s\S]*notification_rule_content_contracts/iu,
  )
  for (const relation of [
    "notification_rules",
    "notification_templates",
    "notification_runtime_flags",
    "notification_dispatch_ownership_claims",
    "notification_deliveries",
    "dashboard_notifications",
    "makeup_notification_deliveries",
    "notification_rule_reconciliation_jobs",
    "notification_target_reconciliation_jobs",
  ]) {
    assert.match(pgTap, new RegExp(relation, "iu"), `pgTAP snapshots ${relation}`)
  }
  assert.match(pgTap, /conformant custom active pointer remains untouched/iu)
  assert.match(pgTap, /legacy nonconformant custom active pointer remains untouched/iu)
  assert.match(pgTap, /repeat audit creates no duplicate template compliance row/iu)
  assert.match(pgTap, /repeat audit creates no duplicate request record/iu)
  assert.doesNotMatch(pgTap, /https?:\/\/|supabase\.co|webhook/iu)
})
