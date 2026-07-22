import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { collectNotificationDeploymentReceipt } from "../scripts/record-notification-deployment-receipt.mjs"

const googleChatUrl = new URL("../src/app/api/google-chat/route.ts", import.meta.url)
const webPushUrl = new URL("../src/app/api/web-push/route.ts", import.meta.url)
const workerUrl = new URL("../src/app/api/notifications/worker/route.ts", import.meta.url)
const telemetryUrl = new URL("../supabase/migrations/20260716194500_notification_legacy_contract_telemetry.sql", import.meta.url)
const closureUrl = new URL("../supabase/pending-migrations/notification-cutover/20260716195000_notification_workflow_legacy_closure.sql", import.meta.url)
const workerScheduleUrl = new URL("../supabase/pending-migrations/notification-cutover/20260716195500_notification_worker_schedule.sql", import.meta.url)
const forwardCompatUrl = new URL("../supabase/pending-migrations/notification-cutover/20260716195900_notification_control_plane_forward_compat.sql", import.meta.url)
const contractVersionUrl = new URL("../src/app/api/notifications/contract-version/route.ts", import.meta.url)
const deploymentReceiptWriterUrl = new URL("../scripts/record-notification-deployment-receipt.mjs", import.meta.url)
const workflowSeedPgTapUrl = new URL("../supabase/pending-migrations/notification-cutover/tests/notification_workflow_seed_test.sql", import.meta.url)

function functionBlock(source, name) {
  const start = source.indexOf(`export async function ${name}`)
  assert.notEqual(start, -1, `${name} 함수를 찾을 수 없습니다.`)
  const next = source.indexOf("\nexport async function ", start + 1)
  return source.slice(start, next === -1 ? source.length : next)
}

test("Google Chat POST는 raw 호환 페이로드를 계측만 하고 provider로 직접 보내지 않는다", async () => {
  const source = await readFile(googleChatUrl, "utf8")
  const post = functionBlock(source, "POST")
  assert.match(post, /notification_payload_forbidden/)
  assert.match(post, /sourceEventId/)
  assert.match(post, /dispatchLegacy(?:OpsTask|Makeup)Source/)
  const authIndex = post.indexOf("getAuthenticatedContext")
  const bodyIndex = post.indexOf("request.json")
  const trafficIndex = post.indexOf("recordNotificationContractTraffic")
  const closedIndex = post.indexOf("closure.closed")
  const compatibilityReturnIndex = post.indexOf("legacy_payload_observed")
  assert.ok(authIndex >= 0 && bodyIndex > authIndex)
  assert.ok(trafficIndex > bodyIndex && closedIndex > trafficIndex && compatibilityReturnIndex > closedIndex)
  assert.match(post, /legacy_untranslatable/)
  assert.match(post, /compatibilityPath/)
  assert.match(post, /legacy_payload_observed/)
  assert.doesNotMatch(post, /fetch\(webhookUrl/)
  assert.match(source, /X-Notification-Contract-Version/)
  assert.match(post, /beginNotificationContractV2Route/)
  assert.match(post, /recordNotificationContractRouteOutcome/)
  assert.match(source, /classifyNotificationContractRouteResponse/)
  assert.match(source, /response\.clone\(\)\.json\(\)/)
  assert.match(source, /failedCount > 0/)
  assert.match(source, /sentCount \+ dedupedCount > 0/)
  assert.match(source, /VERCEL_GIT_COMMIT_SHA/)
  assert.match(source, /p_build_revision_hash/)
  assert.doesNotMatch(post, /resolve_legacy_notification_source_route_v1/)
  assert.doesNotMatch(post, /outcome:\s*"translated"/)
  const dispatchIndex = post.indexOf("dispatchLegacy")
  const outcomeIndex = post.indexOf("recordNotificationContractRouteOutcome", dispatchIndex)
  assert.ok(dispatchIndex >= 0 && outcomeIndex > dispatchIndex)

  const get = functionBlock(source, "GET")
  const patch = functionBlock(source, "PATCH")
  assert.match(get, /getGoogleChatWebhookUrl/)
  assert.match(patch, /replaceLegacyGoogleChatConnection/)
})

test("Web Push POST는 raw 호환 페이로드를 계측만 하고 provider로 직접 보내지 않는다", async () => {
  const source = await readFile(webPushUrl, "utf8")
  const post = functionBlock(source, "POST")
  assert.match(post, /notification_payload_forbidden/)
  assert.match(post, /\},\s*422\)/)
  const trafficIndex = post.indexOf("inspectAndRecordLegacyContract")
  const closedIndex = post.indexOf("closure.closed")
  const compatibilityReturnIndex = post.indexOf("legacy_payload_observed")
  assert.ok(trafficIndex >= 0 && closedIndex > trafficIndex)
  assert.ok(compatibilityReturnIndex > closedIndex)
  assert.match(source, /legacy_untranslatable/)
  assert.match(post, /compatibilityPath/)
  assert.match(post, /legacy_payload_observed/)
  assert.doesNotMatch(post, /webpush\.sendNotification/)
  assert.match(source, /X-Notification-Contract-Version/)
})

test("계약 증거표는 service_role 직접 DML을 막고 고정 SECURITY DEFINER RPC만 노출한다", async () => {
  const source = await readFile(telemetryUrl, "utf8")
  assert.match(source, /notification_contract_bridge_state/)
  assert.match(source, /closed_at timestamp with time zone/)
  assert.match(source, /notification_contract_traffic/)
  assert.match(source, /for share/)
  assert.match(source, /record_notification_contract_traffic_v1/)
  assert.match(source, /begin_notification_contract_v2_route_v1/)
  assert.match(source, /record_notification_contract_route_outcome_v1/)
  assert.match(source, /record_notification_contract_deployment_receipt_v1/)
  assert.match(source, /get_notification_contract_drain_evidence_v1/)
  assert.match(source, /p_window_end < v_now - interval '5 minutes'/)
  assert.match(source, /p_window_start < v_installed_at/)
  assert.match(source, /notification_contract_route_outcomes/)
  assert.match(source, /notification_contract_deployment_receipts/)
  assert.match(source, /source_event_id uuid/)
  assert.match(source, /fixed_route text/)
  assert.match(source, /translator_failed/)
  assert.match(source, /active_server_deployment_hashes/)
  assert.match(source, /build_revision_hash text/)
  assert.match(source, /notification_sha256_hex_v1/)
  assert.match(source, /register_notification_external_attempt_v1/)
  assert.match(
    source.replace(/\s+/g, " "),
    /revoke all on table dashboard_private\.notification_contract_(?:bridge_state|traffic|route_outcomes|deployment_receipts) from public, anon, authenticated, service_role/i,
  )
  assert.doesNotMatch(source, /grant (?:all|insert|update|delete)[^;]*service_role/i)
  assert.match(
    source.replace(/\s+/g, " "),
    /revoke all on table dashboard_private\.notification_audit_logs from service_role; grant select on table dashboard_private\.notification_audit_logs to service_role;/i,
  )
  assert.match(source, /grant execute on function public\.begin_notification_contract_v2_route_v1/)
  assert.match(source, /grant execute on function public\.record_notification_contract_route_outcome_v1/)
  assert.match(source, /grant execute on function public\.record_notification_contract_deployment_receipt_v1/)
  assert.match(source, /event_row\.payload ->> 'source_event_id' = p_source_event_id::text/)
  assert.match(source, /'makeup_requests'[\s\S]*'makeup_request_event'[\s\S]*'\/api\/notifications\/legacy\/makeup'/)
  assert.doesNotMatch(source, /registration_appointment'[\s\S]{0,100}legacy\/ops-task/)
  assert.match(source, /'closed', v_closed_at is not null/)
  assert.doesNotMatch(source, /\btitle\b|\bbody\b|recipient|webhook_url|payload_json|endpoint|secret/)
})

test("관찰·폐쇄·worker 마이그레이션의 epoch 계산은 PostgreSQL 17 호환 date_part만 사용한다", async () => {
  const migrations = [
    ["194500 관찰", telemetryUrl, 3],
    ["195000 폐쇄", closureUrl, 1],
    ["195500 worker", workerScheduleUrl, 6],
  ]

  for (const [label, url, expectedEpochCalculationCount] of migrations) {
    const source = await readFile(url, "utf8")
    assert.doesNotMatch(
      source,
      /\bpg_catalog\.extract\s*\(/i,
      `${label} 마이그레이션은 특수 문법 EXTRACT를 함수처럼 스키마 한정하면 안 됩니다.`,
    )

    const epochCalculations = source.match(
      /\bpg_catalog\.date_part\s*\(\s*'epoch'\s*,/gi,
    ) ?? []
    assert.equal(
      epochCalculations.length,
      expectedEpochCalculationCount,
      `${label} 마이그레이션의 모든 epoch 계산은 pg_catalog.date_part('epoch', expression)여야 합니다.`,
    )
    assert.doesNotMatch(
      source,
      /(?<!pg_catalog\.)\bdate_part\s*\(\s*'epoch'\s*,/i,
      `${label} 마이그레이션의 date_part는 pg_catalog로 한정해야 합니다.`,
    )
  }
})

test("194500 관찰 번들은 휴보강 delivery intent RPC를 먼저 제공하고 195900이 같은 계약을 안전하게 교체한다", async () => {
  const [telemetry, forwardCompat] = await Promise.all([
    readFile(telemetryUrl, "utf8"),
    readFile(forwardCompatUrl, "utf8"),
  ])
  const signature = /create or replace function public\.record_legacy_notification_delivery_intent_v1\(\s*p_delivery_id uuid,\s*p_legacy_template_checksum text,\s*p_normalized_rendered_hash text,\s*p_request_id uuid\s*\)/
  assert.match(telemetry, signature)
  assert.match(telemetry, /'recorded', false,\s*'shadow', false,\s*'reason', 'shadow_contract_pending'/)
  const normalizedTelemetry = telemetry.replace(/\s+/g, " ")
  assert.match(
    normalizedTelemetry,
    /revoke all on function public\.record_legacy_notification_delivery_intent_v1\( uuid, text, text, uuid \) from public, anon, authenticated, service_role;/,
  )
  assert.match(
    normalizedTelemetry,
    /grant execute on function public\.record_legacy_notification_delivery_intent_v1\( uuid, text, text, uuid \) to service_role;/,
  )
  assert.match(forwardCompat, signature)
})

test("배포 receipt writer는 Vercel production alias와 실행 중 bundle hash를 대조하고 수동 count를 받지 않는다", async () => {
  const [migration, manifestRoute, writer] = await Promise.all([
    readFile(telemetryUrl, "utf8"),
    readFile(contractVersionUrl, "utf8"),
    readFile(deploymentReceiptWriterUrl, "utf8"),
  ])
  const receiptFunction = migration.slice(
    migration.indexOf("create or replace function public.record_notification_contract_deployment_receipt_v1"),
    migration.indexOf("create or replace function public.get_notification_contract_drain_evidence_v1"),
  )
  assert.doesNotMatch(receiptFunction, /v_now timestamp with time zone\s*:=/)
  const bridgeShareIndex = receiptFunction.indexOf("for share;")
  const receiptNowIndex = receiptFunction.indexOf("v_now := pg_catalog.clock_timestamp()", bridgeShareIndex)
  const bucketFreshnessIndex = receiptFunction.indexOf(
    "p_observation_bucket not in (v_current_bucket, v_current_bucket - 1)",
    receiptNowIndex,
  )
  const receiptInsertIndex = receiptFunction.indexOf(
    "insert into dashboard_private.notification_contract_deployment_receipts",
    bucketFreshnessIndex,
  )
  assert.ok(
    bridgeShareIndex >= 0
      && receiptNowIndex > bridgeShareIndex
      && bucketFreshnessIndex > receiptNowIndex
      && receiptInsertIndex > bucketFreshnessIndex,
    "배포 영수증은 bridge 잠금 뒤 시각·bucket을 재검증한 뒤에만 기록해야 한다",
  )
  assert.doesNotMatch(receiptFunction, /p_total_server_instances|p_bridge_aware_server_instances|p_pre_bridge_server_instances|p_total_client_bundles|p_bridge_aware_client_bundles/)
  assert.match(receiptFunction, /vercel_production_alias_v1/)
  assert.match(manifestRoute, /VERCEL_DEPLOYMENT_ID/)
  assert.match(manifestRoute, /VERCEL_PROJECT_ID/)
  assert.match(manifestRoute, /VERCEL_GIT_COMMIT_SHA/)
  assert.match(manifestRoute, /buildRevisionHash/)
  assert.match(manifestRoute, /contractVersion:\s*2/)
  assert.doesNotMatch(manifestRoute, /SUPABASE_SERVICE_ROLE_KEY|VERCEL_TOKEN/)
  assert.match(writer, /api\.vercel\.com\/v13\/deployments/)
  assert.match(writer, /api\/notifications\/contract-version/)
  assert.match(writer, /record_notification_contract_deployment_receipt_v1/)
  assert.match(writer, /deploymentIdHash/)
  assert.match(writer, /projectIdHash/)
  assert.doesNotMatch(writer, /p_deployment_key_hash|p_inventory_observation_hash/)
  assert.match(
    migration.replace(/\s+/g, " "),
    /alter function public\.record_notification_contract_deployment_receipt_v1\( uuid, text, text, integer, bigint, text\[\], text\[\], text\[\] \) owner to postgres/,
  )
})

test("배포 receipt writer와 DB RPC의 인자 키·배열 계약이 정확히 일치한다", async () => {
  const deploymentId = "dpl_bridge_aware_production"
  const projectId = "prj_notifications"
  const buildRevision = "1234567890abcdef1234567890abcdef12345678"
  const hash = (value) => createHash("sha256").update(value, "utf8").digest("hex")
  const calls = []
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input)
    calls.push({ url, init })
    if (url.hostname === "api.vercel.com") {
      return Response.json({
        id: deploymentId,
        projectId,
        target: "production",
        readyState: "READY",
        alias: ["notifications.example.com"],
      })
    }
    if (url.pathname === "/api/notifications/contract-version") {
      return Response.json({
        ok: true,
        contractVersion: 2,
        environment: "production",
        deploymentIdHash: hash(deploymentId),
        projectIdHash: hash(projectId),
        buildRevisionHash: hash(buildRevision),
      })
    }
    return Response.json({
      recorded: true,
      requestId: "00000000-0000-4000-8000-000000000001",
      inventorySource: "vercel_production_alias_v1",
      buildRevisionHash: hash(buildRevision),
      recordedAt: "2026-07-17T00:00:00.000Z",
    })
  }

  const now = Date.parse("2026-07-17T00:02:00.000Z")
  await collectNotificationDeploymentReceipt({
    productionOrigin: "https://notifications.example.com",
    vercelProjectId: projectId,
    vercelTeamId: "team_notifications",
    vercelToken: "test-vercel-token",
    supabaseUrl: "https://project.supabase.co",
    supabaseServiceRoleKey: "test-service-role-key",
  }, { fetchImpl, now })

  assert.equal(calls.length, 3)
  const rpcBody = JSON.parse(calls[2].init.body)
  assert.deepEqual(Object.keys(rpcBody).sort(), [
    "p_active_server_deployment_hashes",
    "p_bridge_aware_server_deployment_hashes",
    "p_build_revision_hash",
    "p_contract_version",
    "p_observation_bucket",
    "p_pre_bridge_server_deployment_hashes",
    "p_project_key_hash",
    "p_request_id",
  ])
  assert.deepEqual(rpcBody.p_active_server_deployment_hashes, [hash(deploymentId)])
  assert.deepEqual(rpcBody.p_bridge_aware_server_deployment_hashes, [hash(deploymentId)])
  assert.deepEqual(rpcBody.p_pre_bridge_server_deployment_hashes, [])
  assert.equal(rpcBody.p_project_key_hash, hash(projectId))
  assert.equal(rpcBody.p_build_revision_hash, hash(buildRevision))
  assert.equal(rpcBody.p_observation_bucket, Math.floor(now / (5 * 60_000)))
})

test("DB drain evidence는 translator·route outcome·24시간·하루 전체·배포 receipt를 직접 집계한다", async () => {
  const source = await readFile(telemetryUrl, "utf8")
  const normalized = source.replace(/\s+/g, " ")
  assert.match(source, /sourceIdTranslatorFailures/)
  assert.match(source, /pendingV2RouteOutcomes/)
  assert.match(source, /failedV2RouteOutcomes/)
  assert.match(source, /opsTaskRouteSuccesses/)
  assert.match(source, /makeupRouteSuccesses/)
  assert.match(source, /fullOperatingDayCovered/)
  assert.match(source, /deploymentEvidenceCoversWindow/)
  assert.doesNotMatch(source, /bridgeAwareClientRatio/)
  assert.match(source, /latestDeploymentReceiptAt/)
  assert.match(source, /deploymentBuildRevisionCount/)
  assert.match(source, /latestCompliantBuildRevisionHash/)
  assert.match(source, /maximumDeploymentReceiptGapSeconds/)
  assert.match(normalized, /traffic\.outcome = 'translator_failed'/)
  assert.match(normalized, /left join dashboard_private\.notification_contract_route_outcomes/)
  assert.match(normalized, /notification_contract_deployment_receipts/)
  assert.match(normalized, /Asia\/Seoul/)
})

test("worker는 인증 뒤 private runtime gate를 통과하기 전 claim을 시작하지 않는다", async () => {
  const source = await readFile(workerUrl, "utf8")
  const post = functionBlock(source, "POST")
  const authIndex = post.indexOf("notification_worker_unauthorized")
  const gateIndex = post.indexOf("assert_notification_worker_run_allowed_v1")
  const runIndex = post.indexOf("worker.runBatch")
  assert.ok(authIndex >= 0 && gateIndex > authIndex && runIndex > gateIndex)
  assert.match(post, /notification_worker_stopped/)
  assert.match(source, /X-Notification-Contract-Version/)
})

test("closure migration은 writer 회수 뒤 보관 이력 최종 parity를 검증하고 고정 목적 RPC만 남긴다", async () => {
  const [source, pgTap] = await Promise.all([
    readFile(closureUrl, "utf8"),
    readFile(workflowSeedPgTapUrl, "utf8"),
  ])
  const normalized = source.replace(/\s+/g, " ")
  for (const table of [
    "public.dashboard_notifications",
    "public.ops_task_events",
    "public.ops_task_comments",
    "public.makeup_requests",
    "public.makeup_request_events",
    "public.makeup_notification_deliveries",
    "public.approval_events",
    "public.approval_comments",
  ]) {
    assert.match(normalized, new RegExp(`revoke (?:insert|update|delete|insert, update, delete|all)(?:, (?:insert|update|delete))* on table ${table.replaceAll(".", "\\.")} from authenticated`, "i"))
    assert.match(normalized, new RegExp(`grant select on table ${table.replaceAll(".", "\\.")} to authenticated`, "i"))
  }
  const writerRevokeIndex = source.indexOf(
    "revoke insert, update, delete on table public.makeup_notification_deliveries from authenticated",
  )
  const finalImportIndex = source.indexOf(
    "notification_import_makeup_retained_state_v1",
  )
  const finalLockIndex = source.indexOf(
    "lock table public.makeup_notification_deliveries in share row exclusive mode",
  )
  assert.ok(
    writerRevokeIndex >= 0
      && finalLockIndex > writerRevokeIndex
      && finalImportIndex > finalLockIndex,
  )
  assert.match(source, /notification_assert_makeup_retained_import_complete_v1/)
  assert.match(source, /notification_makeup_legacy_final_parity_failed/)
  assert.match(source, /'legacy_writer_closed'/)
  assert.match(source, /notification_workflow_legacy_closure_version/)
  assert.match(source, /notification_source_type_registry/)
  assert.match(source, /notification_contract_drain_not_complete/)
  assert.match(source, /notification_contract_bridge_state/)
  assert.match(source, /legacy_untranslatable/)
  assert.match(source, /translator_failed/)
  assert.match(source, /notification_contract_route_outcomes/)
  assert.match(source, /notification_contract_deployment_receipts/)
  assert.doesNotMatch(source, /pg_catalog\.coalesce\s*\(/)
  assert.doesNotMatch(source, /bridge_aware_client_bundles/)
  assert.match(source, /pre_bridge_server_instances/)
  assert.match(source, /v_ops_task_route_successes = 0/)
  assert.match(source, /v_makeup_route_successes = 0/)
  assert.match(source, /v_deployment_build_revision_count <> 1/)
  assert.match(source, /traffic\.build_revision_hash = v_closure_build_revision_hash/)
  assert.match(source, /build_revision_hash text not null/)
  assert.match(source, /evidence_window_start timestamp with time zone not null/)
  assert.match(source, /evidence_first_receipt_id uuid not null/)
  assert.match(source, /insert into dashboard_private\.notification_contract_closures/)
  assert.match(source, /notification_contract_fixed_route_v1\(p_source_event_id\)/)
  assert.match(source, /Asia\/Seoul/)
  assert.match(source, /interval '24 hours'/)
  assert.match(source, /set closed_at = v_drain_window_end/)
  assert.match(source, /applied_at timestamp with time zone not null default pg_catalog\.clock_timestamp\(\)/)
  assert.doesNotMatch(source, /v_drain_window_end timestamp with time zone\s*:=\s*pg_catalog\.statement_timestamp/)
  const bridgeLockIndex = source.indexOf("for update;", source.indexOf("notification_contract_bridge_state state"))
  const cutoffIndex = source.indexOf("v_drain_window_end := pg_catalog.clock_timestamp()", bridgeLockIndex)
  const windowIndex = source.indexOf("v_drain_window_start :=", cutoffIndex)
  const evidenceIndex = source.indexOf("select pg_catalog.count(*) into v_translator_failures", windowIndex)
  assert.ok(
    bridgeLockIndex >= 0
      && cutoffIndex > bridgeLockIndex
      && windowIndex > cutoffIndex
      && evidenceIndex > windowIndex,
    "폐쇄 증거 시각은 bridge 배타 잠금 뒤 고정하고 그 뒤 증거를 집계해야 한다",
  )
  assert.match(source, /\('registration', 'registration_appointment', 'uuid', null, 2\)/)
  assert.doesNotMatch(source, /notification_workflow_adapters_runtime_version/)
  assert.match(pgTap, /notification_contract_closures/)
  assert.match(pgTap, /first_receipt\.build_revision_hash <> closure\.build_revision_hash/)
  assert.match(pgTap, /notification_audit_logs', 'TRUNCATE'/)
})
