import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationUrl = new URL(
  "../supabase/migrations/20260716196000_notification_shadow_fixture_runner.sql",
  import.meta.url,
)
const scriptUrl = new URL("../scripts/run-notification-shadow-fixtures.mjs", import.meta.url)

function sqlFunctionBlock(source, qualifiedName) {
  const start = source.indexOf(`create or replace function ${qualifiedName}`)
  assert.notEqual(start, -1, `${qualifiedName} 함수를 찾을 수 없습니다.`)
  const next = source.indexOf("\ncreate or replace function ", start + 1)
  return source.slice(start, next === -1 ? source.length : next)
}

test("2인자 증거 RPC는 활성 규칙 범위에서 자연 발생 비교만 선택한다", async () => {
  const source = await readFile(migrationUrl, "utf8")
  const runner = sqlFunctionBlock(
    source,
    "public.record_notification_shadow_fixture_evidence_v1",
  )

  assert.match(runner, /p_scope_key text,\s*p_request_id uuid/)
  assert.doesNotMatch(runner, /p_evidence_digest|p_completed_cycles|p_external_requests/)
  assert.match(runner, /\(select auth\.role\(\)\) <> 'service_role'/)
  assert.match(runner, /notification_cutover_scope_order_v1/)
  assert.match(runner, /notification_control_plane_shadow_write_enabled/)
  assert.match(runner, /notification_dispatch_flag_keys_v1/)
  assert.match(runner, /v_owner\.owner_kind <> 'legacy'/)
  assert.match(runner, /notification_worker_stop_latch/)
  assert.match(runner, /notification_recent_runtime_heartbeats_v1/)
  assert.match(runner, /notification_schedule_contract_ready_v1/)

  assert.match(runner, /count\(\*\)::integer[\s\S]*rule_row\.enabled/)
  assert.match(runner, /v_enabled_rule_count > 0/)
  assert.match(runner, /event_row\.source_type <> 'notification_shadow_fixture_v1'/)
  assert.match(runner, /notification_shadow_comparison_current_v1/)
  assert.match(runner, /notification_shadow_natural_comparison_required/)
  assert.match(runner, /natural_comparison_verified/)
  assert.doesNotMatch(runner, /materialize_notification_delivery_v1/)
  assert.doesNotMatch(runner, /record_legacy_notification_intent_v1/)
  assert.doesNotMatch(runner, /insert into dashboard_private\.notification_events/)
  assert.doesNotMatch(runner, /notification_target_set_hash_v1/)
  assert.doesNotMatch(runner, /begin_legacy_notification_dispatch_v1/)
  assert.doesNotMatch(runner, /register_notification_external_attempt_v1/)
  assert.doesNotMatch(runner, /insert into public\.dashboard_notifications/)

  assert.match(
    source,
    /revoke all on function public\.record_notification_shadow_fixture_evidence_v1\(\s*text, uuid\s*\)[\s\S]*from public, anon, authenticated/,
  )
  assert.match(
    source,
    /grant execute on function public\.record_notification_shadow_fixture_evidence_v1\(\s*text, uuid\s*\) to service_role/,
  )
})

test("활성 규칙 0개 증거는 현재 설정 digest와 shadow revision이 그대로일 때만 유효하다", async () => {
  const source = await readFile(migrationUrl, "utf8")
  const runner = sqlFunctionBlock(
    source,
    "public.record_notification_shadow_fixture_evidence_v1",
  )
  const current = sqlFunctionBlock(
    source,
    "dashboard_private.notification_no_active_rule_evidence_current_v1",
  )
  const complete = sqlFunctionBlock(
    source,
    "dashboard_private.notification_shadow_scope_evidence_complete_v1",
  )

  assert.match(source, /create table dashboard_private\.notification_shadow_no_active_rule_evidence/)
  assert.match(source, /enabled_rule_count integer not null[\s\S]*check \(enabled_rule_count = 0\)/)
  assert.match(source, /enable row level security/)
  assert.match(source, /revoke all on table dashboard_private\.notification_shadow_no_active_rule_evidence/)
  assert.match(runner, /v_enabled_rule_count = 0/)
  assert.match(runner, /notification_shadow_scope_config_digest_v1/)
  assert.match(runner, /shadow_no_active_rule_verified/)
  assert.match(runner, /notification_shadow_no_active_rule_evidence/)

  assert.match(current, /notification_shadow_no_active_rule_evidence/)
  assert.match(current, /evidence\.enabled_rule_count = 0/)
  assert.match(current, /not exists[\s\S]*rule_row\.enabled/)
  assert.match(current, /notification_shadow_scope_config_digest_v1\(p_scope_key\)/)
  assert.match(current, /evidence\.scope_config_digest/)
  assert.match(current, /evidence\.shadow_revision = shadow_flag\.revision/)
  assert.match(current, /evidence\.created_at >= boundary\.evidence_since/)
  assert.match(current, /shadow_no_active_rule_verified/)

  assert.match(complete, /v_enabled_rule_count/)
  assert.match(complete, /notification_no_active_rule_evidence_current_v1/)
  assert.match(complete, /notification_shadow_comparison_current_v1/)
})

test("현재성 검증은 self-parity fixture를 거절하고 운영 closed/sent만 유지한다", async () => {
  const source = await readFile(migrationUrl, "utf8")
  const current = sqlFunctionBlock(
    source,
    "dashboard_private.notification_shadow_comparison_current_v1",
  )

  assert.match(current, /event_row\.source_type <> 'notification_shadow_fixture_v1'/)
  assert.match(current, /canonical_intent_recorded/)
  assert.match(current, /legacy_intent_recorded/)
  assert.match(current, /delivery\.status = 'skipped'/)
  assert.match(current, /delivery\.status_reason = 'shadow_mode'/)
  assert.match(current, /ownership\.state = 'closed'/)
  assert.match(current, /ownership\.terminal_outcome = 'sent'/)
  assert.match(current, /legacy_dispatch_finalized/)
  assert.doesNotMatch(current, /fixture_no_external_side_effect/)
})

test("운영 runner는 고정 10개 scope와 자연 비교·무활성 결과를 모두 검증한다", async () => {
  const runner = await import(scriptUrl.href)
  const batchRequestId = "11111111-1111-4111-8111-111111111111"
  assert.deepEqual(runner.NOTIFICATION_SHADOW_FIXTURE_SCOPES, [
    "tasks",
    "word_retests",
    "approvals",
    "transfer",
    "withdrawal",
    "makeup_requests",
    "registration",
    "registration_phone",
    "registration_visit",
    "registration_solapi",
  ])

  const dryRun = runner.buildNotificationShadowFixturePlan({
    execute: false,
    batchRequestId,
  })
  assert.equal(dryRun.calls.length, 10)
  assert.equal(new Set(dryRun.calls.map((call) => call.parameters.p_request_id)).size, 10)
  assert.throws(
    () => runner.buildNotificationShadowFixturePlan({ execute: true, batchRequestId }),
    /explicit_shadow_fixture_authorization_required/,
  )

  const plan = runner.buildNotificationShadowFixturePlan({
    execute: true,
    authorization: "shadow-fixture-approved",
    batchRequestId,
  })
  let index = 0
  const calledRpcNames = []
  const result = await runner.executeNotificationShadowFixturePlan(plan, {
    async rpc(name, parameters) {
      calledRpcNames.push(name)
      if (name === "verify_notification_shadow_evidence_complete_v1") {
        return { verified: true, scopeCount: 10 }
      }
      if (name.includes("deterministic")) throw new Error(`unexpected_rpc:${name}`)
      const natural = index++ % 2 === 1
      return {
        recorded: true,
        scopeKey: parameters.p_scope_key,
        requestId: parameters.p_request_id,
        evidenceKind: natural ? "natural_comparison" : "no_active_rule",
        enabledRuleCount: natural ? 1 : 0,
        comparisonKey: natural ? "a".repeat(64) : null,
        scopeConfigDigest: "b".repeat(64),
      }
    },
  })
  assert.equal(result.completedScopes, 10)
  assert.equal(result.scopes.filter((scope) => scope.evidenceKind === "natural_comparison").length, 5)
  assert.equal(result.scopes.filter((scope) => scope.evidenceKind === "no_active_rule").length, 5)
  assert.equal(calledRpcNames.some((name) => name.includes("deterministic")), false)
  assert.equal(calledRpcNames.includes("replay_notification_shadow_evidence_v1"), false)
  assert.deepEqual(calledRpcNames, [
    ...Array(10).fill("record_notification_shadow_fixture_evidence_v1"),
    "verify_notification_shadow_evidence_complete_v1",
  ])
})

test("후속 운영 gate는 결정적 DB 증거를 인정하지 않고 public 결정적 RPC를 닫는다", async () => {
  const source = await readFile(
    new URL("../supabase/migrations/20260717145304_notification_shadow_deterministic_evidence.sql", import.meta.url),
    "utf8",
  )
  const complete = sqlFunctionBlock(
    source,
    "dashboard_private.notification_shadow_scope_evidence_complete_v1",
  )
  const replay = sqlFunctionBlock(
    source,
    "public.replay_notification_shadow_evidence_v1",
  )
  const activeBranchStart = complete.indexOf("if v_enabled_rule_count > 0 then")
  const zeroRuleBranchStart = complete.indexOf("else", activeBranchStart)
  assert.notEqual(activeBranchStart, -1)
  assert.notEqual(zeroRuleBranchStart, -1)
  const activeRuleBranch = complete.slice(activeBranchStart, zeroRuleBranchStart)
  const zeroRuleBranch = complete.slice(zeroRuleBranchStart)

  assert.match(activeRuleBranch, /not dashboard_private\.notification_shadow_rule_natural_evidence_current_v1/)
  assert.match(activeRuleBranch, /return false/)
  assert.doesNotMatch(activeRuleBranch, /notification_no_active_rule_evidence_current_v1/)
  assert.match(zeroRuleBranch, /notification_no_active_rule_evidence_current_v1/)
  assert.doesNotMatch(complete, /notification_shadow_deterministic_evidence/)
  assert.doesNotMatch(replay, /notification_shadow_deterministic_evidence/)
  assert.match(
    source,
    /revoke all on function public\.prepare_notification_shadow_deterministic_fixture_v1\(text, uuid\)[\s\S]*?from public, anon, authenticated, service_role/,
  )
  assert.match(
    source,
    /revoke all on function public\.record_notification_shadow_deterministic_evidence_v1\([\s\S]*?from public, anon, authenticated, service_role/,
  )
  assert.match(
    source,
    /revoke all on function public\.replay_notification_shadow_evidence_v1\(text, uuid\)[\s\S]*?from public, anon, authenticated, service_role/,
  )
  assert.doesNotMatch(
    source,
    /grant execute on function public\.(?:prepare_notification_shadow_deterministic_fixture_v1|record_notification_shadow_deterministic_evidence_v1|replay_notification_shadow_evidence_v1)/,
  )
})
