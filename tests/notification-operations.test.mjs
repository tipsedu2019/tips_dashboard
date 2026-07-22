import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const metricsUrl = new URL("../src/features/notifications/server/notification-operations-metrics.ts", import.meta.url)
const scheduleScriptUrl = new URL("../scripts/manage-notification-worker-schedule.mjs", import.meta.url)
const drainScriptUrl = new URL("../scripts/verify-notification-contract-drain.mjs", import.meta.url)
const scheduleMigrationUrl = new URL("../supabase/pending-migrations/notification-cutover/20260716195500_notification_worker_schedule.sql", import.meta.url)
const forwardMigrationUrl = new URL("../supabase/pending-migrations/notification-cutover/20260716195900_notification_control_plane_forward_compat.sql", import.meta.url)

function healthyMetrics() {
  return {
    generated_at: "2026-07-17T12:00:00.000Z",
    worker_heartbeat_at: "2026-07-17T11:59:20.000Z",
    watchdog_heartbeat_at: "2026-07-17T11:59:30.000Z",
    worker_heartbeat_age_seconds: 40,
    watchdog_heartbeat_age_seconds: 30,
    worker_stop_latch: false,
    worker_stop_latch_revision: "1",
    queue: [],
    jobs: { fanout: 0, rule_reconciliation: 0, target_reconciliation: 0 },
    closed_reasons: [],
    ownership_denial_count: 0,
    shadow_comparison: { matched: 3, mismatched: 0, match_rate_basis_points: 10_000 },
    stop_metrics: {
      canonical_provider_requests_in_shadow: 0,
      canonical_inbox_projections_in_shadow: 0,
      duplicate_external_attempts: 0,
      new_delivery_unknown: 0,
      pending_lag_seconds: 0,
      scope_mismatch_count: 0,
      zero_audience_enabled_rule_count: 0,
      ownership_anomaly_count: 0,
      ownership_denial_count: 0,
      shadow_mismatch_count: 0,
      rollback_failed_count: 0,
      missed_worker_heartbeats: 0,
      schedule_contract_fault_count: 0,
      worker_route_fault_count: 0,
    },
  }
}

function sqlFunctionBlock(source, qualifiedName) {
  const start = source.indexOf(`create or replace function ${qualifiedName}`)
  assert.notEqual(start, -1, `${qualifiedName} 함수를 찾을 수 없습니다.`)
  const next = source.indexOf("\ncreate or replace function ", start + 1)
  return source.slice(start, next === -1 ? source.length : next)
}

test("운영 metrics mapper는 닫힌 숫자 계약만 반환하고 PII 키를 거절한다", async () => {
  const metrics = await import(metricsUrl.href)
  const mapped = metrics.normalizeNotificationOperationsMetrics(healthyMetrics())
  assert.deepEqual(mapped.stopMetrics, {
    canonicalProviderRequestsInShadow: 0,
    canonicalInboxProjectionsInShadow: 0,
    duplicateExternalAttempts: 0,
    newDeliveryUnknown: 0,
    pendingLagSeconds: 0,
    scopeMismatchCount: 0,
    zeroAudienceEnabledRuleCount: 0,
    ownershipAnomalyCount: 0,
    ownershipDenialCount: 0,
    shadowMismatchCount: 0,
    rollbackFailedCount: 0,
    missedWorkerHeartbeats: 0,
    scheduleContractFaultCount: 0,
    workerRouteFaultCount: 0,
  })
  assert.deepEqual(mapped.shadowComparison, {
    matched: 3,
    mismatched: 0,
    matchRateBasisPoints: 10_000,
  })
  assert.throws(
    () => metrics.normalizeNotificationOperationsMetrics({ ...healthyMetrics(), recipient_phone: "01000000000" }),
    /notification_operations_metrics_invalid/,
  )
})

test("stop threshold는 shadow side effect, unknown, 3 missed heartbeat, 5분 lag를 즉시 차단한다", async () => {
  const metrics = await import(metricsUrl.href)
  const unsafe = healthyMetrics()
  unsafe.stop_metrics.canonical_provider_requests_in_shadow = 1
  unsafe.stop_metrics.new_delivery_unknown = 1
  unsafe.stop_metrics.missed_worker_heartbeats = 3
  unsafe.stop_metrics.pending_lag_seconds = 301
  assert.deepEqual(metrics.notificationOperationsBlockers(
    metrics.normalizeNotificationOperationsMetrics(unsafe),
  ), [
    "canonical_provider_in_shadow",
    "delivery_unknown_detected",
    "worker_heartbeat_missed",
    "queue_lag",
  ])
})

test("schedule 관리자 dry-run은 정확히 두 이름만 관리하고 URL·secret을 SQL에 넣지 않는다", async () => {
  const schedule = await import(scheduleScriptUrl.href)
  assert.deepEqual(schedule.NOTIFICATION_SCHEDULE_NAMES, [
    "tips-notification-worker-v1",
    "tips-notification-cutover-watchdog-v1",
  ])
  for (const mode of ["inspect", "install", "disable", "remove"]) {
    const plan = schedule.buildNotificationSchedulePlan({ mode, execute: false })
    assert.equal(plan.execute, false)
    assert.equal(plan.statements.length >= 1, true)
    assert.doesNotMatch(JSON.stringify(plan), /Bearer|https:\/\//)
  }
  assert.throws(
    () => schedule.buildNotificationSchedulePlan({ mode: "install", execute: true }),
    /explicit_schedule_authorization_required/,
  )
})

test("schedule 관리자는 명시 승인과 request ID가 있을 때만 고정 RPC를 실행한다", async () => {
  const schedule = await import(scheduleScriptUrl.href)
  const requestId = "11111111-1111-4111-8111-111111111111"
  const plan = schedule.buildNotificationSchedulePlan({
    mode: "install",
    execute: true,
    authorization: "schedule-change-approved",
    requestId,
  })
  const calls = []
  const result = await schedule.executeNotificationSchedulePlan(plan, {
    async rpc(name, parameters) {
      calls.push({ name, parameters })
      return { worker_count: 1, watchdog_count: 1 }
    },
  })
  assert.deepEqual(calls, [{
    name: "manage_notification_worker_schedule_v1",
    parameters: { p_action: "install", p_request_id: requestId },
  }])
  assert.deepEqual(result, { worker_count: 1, watchdog_count: 1 })
})

test("24시간/full operating day drain verifier는 stale bundle·old server가 모두 0이어야 통과한다", async () => {
  const drain = await import(drainScriptUrl.href)
  const evidence = {
    evidenceVersion: 2,
    evidenceSource: "get_notification_contract_drain_evidence_v1",
    generatedAt: "2026-07-17T15:00:01.000Z",
    windowStart: "2026-07-16T15:00:00.000Z",
    windowEnd: "2026-07-17T15:00:00.000Z",
    bridgeInstalledAt: "2026-07-16T14:59:00.000Z",
    continuousHours: 24,
    fullOperatingDayCovered: true,
    untranslatableOldContractTraffic: 0,
    v2SourceTraffic: 7,
    sourceIdTranslatorFailures: 0,
    pendingV2RouteOutcomes: 0,
    failedV2RouteOutcomes: 0,
    successfulV2RouteOutcomes: 7,
    opsTaskRouteSuccesses: 4,
    makeupRouteSuccesses: 3,
    deploymentReceiptCount: 289,
    earliestDeploymentReceiptAt: "2026-07-16T14:59:00.000Z",
    latestDeploymentReceiptAt: "2026-07-17T15:00:00.000Z",
    deploymentBuildRevisionCount: 1,
    latestCompliantBuildRevisionHash: "a".repeat(64),
    maximumDeploymentReceiptGapSeconds: 300,
    deploymentEvidenceCoversWindow: true,
    preBridgeServerInstances: 0,
    bridgeAwareServerRatio: 1,
    closureReady: true,
  }
  const evidenceNow = Date.parse("2026-07-17T15:01:00.000Z")
  assert.deepEqual(drain.verifyNotificationContractDrain(evidence, evidenceNow), { passed: true, blockers: [] })
  assert.equal(drain.verifyNotificationContractDrain({
    ...evidence,
    continuousHours: 23,
  }, evidenceNow).passed, false)
  assert.equal(drain.verifyNotificationContractDrain({
    ...evidence,
    sourceIdTranslatorFailures: 1,
    closureReady: false,
  }, evidenceNow).passed, false)
  assert.equal(drain.verifyNotificationContractDrain({
    ...evidence,
    deploymentEvidenceCoversWindow: false,
    closureReady: false,
  }, evidenceNow).passed, false)
  assert.equal(drain.verifyNotificationContractDrain({
    ...evidence,
    deploymentBuildRevisionCount: 2,
  }, evidenceNow).passed, false)
})

test("schedule migration은 Vault fail-closed, 두 schedule, atomic watchdog와 마지막 marker를 가진다", async () => {
  const source = await readFile(scheduleMigrationUrl, "utf8")
  assert.match(source, /create extension if not exists pg_cron;/)
  assert.doesNotMatch(source, /create extension if not exists pg_cron with schema/)
  for (const functionName of [
    "activate_notification_dispatch_cutover_v1",
    "abort_notification_shadow_v1",
    "clear_notification_worker_stop_latch_v1",
    "rollback_notification_dispatch_cutover_v1",
    "revalidate_immediate_notification_delivery_v1",
    "get_notification_operations_metrics_v1",
    "invoke_notification_worker_v1",
    "run_notification_cutover_watchdog_v1",
    "record_notification_shadow_fixture_evidence_v1",
  ]) assert.match(source, new RegExp(functionName))
  assert.match(source, /notification_worker_stop_latch/)
  assert.match(source, /notification_watchdog_heartbeats/)
  assert.match(source, /pg_try_advisory_xact_lock/)
  assert.match(source, /vault\.decrypted_secrets/)
  assert.match(source, /notification_worker_url/)
  assert.match(source, /notification_worker_bearer_secret/)
  assert.match(source, /https:\/\//)
  assert.match(source, /:443\/api\/notifications\/worker/)
  assert.match(source, /p_secret ~ '\[\[:cntrl:\]\]'/)
  assert.match(source, /p_secret <> pg_catalog\.btrim\(p_secret\)/)
  assert.match(source, /octet_length\(p_secret\) < 32/)
  assert.match(source, /tips-notification-worker-v1/)
  assert.match(source, /tips-notification-cutover-watchdog-v1/)
  assert.match(source, /interval '3 minutes'/)
  assert.match(source, /interval '5 minutes'/)
  assert.doesNotMatch(source, /extensions\.digest/)
  const sha256 = sqlFunctionBlock(
    source,
    "dashboard_private.notification_sha256_hex_v1",
  )
  assert.match(sha256, /from pg_catalog\.pg_extension extension_row/)
  assert.match(sha256, /extension_row\.extname = 'pgcrypto'/)
  assert.match(sha256, /pg_catalog\.format\([\s\S]*%I\.digest/)
  assert.match(source, /notification_sha256_hex_v1\(\s*p_occurrence_key\s*\)/)
  assert.match(source, /notification_sha256_hex_v1\(\s*p_target_key\s*\)/)

  const scheduleManager = sqlFunctionBlock(
    source,
    "dashboard_private.manage_notification_schedules_v1",
  )
  assert.match(scheduleManager, /pg_advisory_xact_lock/)
  assert.match(scheduleManager, /notification_active_cutover_scope_v1/)
  assert.match(scheduleManager, /for update of flag_row/)
  assert.match(scheduleManager, /perform cron\.alter_job\(v_job\.jobid, active := false\)/)
  assert.doesNotMatch(scheduleManager, /update cron\.job/)
  assert.ok(
    scheduleManager.indexOf("for update of flag_row")
      < scheduleManager.indexOf("pg_advisory_xact_lock"),
  )
  assert.doesNotMatch(
    source,
    /grant execute on function dashboard_private\.(?:manage|inspect)_notification_schedules_v1\([^;]*?to service_role;/s,
  )

  const immediateRevalidator = sqlFunctionBlock(
    source,
    "public.revalidate_immediate_notification_delivery_v1",
  )
  assert.match(immediateRevalidator, /p_workflow_key in \('tasks', 'word_retests'\)/)
  assert.match(immediateRevalidator, /v_delivery\.audience_key in \([\s\S]*?'primary_assignee'[\s\S]*?'assigned_assistant'[\s\S]*?'secondary_assignee'/)
  assert.match(immediateRevalidator, /task\.id::text = v_event\.payload ->> 'task_id'/)
  assert.match(immediateRevalidator, /task\.assignee_id = v_delivery\.target_profile_id/)
  assert.match(immediateRevalidator, /task\.secondary_assignee_id = v_delivery\.target_profile_id/)
  assert.match(immediateRevalidator, /p_workflow_key in \('transfer', 'withdrawal'\)/)
  assert.match(immediateRevalidator, /task\.type = p_workflow_key/)
  assert.match(immediateRevalidator, /source\.event_type = p_event_key/)

  const scheduleConfigurer = sqlFunctionBlock(
    source,
    "public.configure_notification_worker_schedule_v1",
  )
  assert.match(scheduleConfigurer, /p_approved_host is null/)
  const publicScheduleManager = sqlFunctionBlock(
    source,
    "public.manage_notification_worker_schedule_v1",
  )
  assert.match(publicScheduleManager, /p_action is null/)

  const heartbeatGate = sqlFunctionBlock(
    source,
    "dashboard_private.notification_success_heartbeats_fresh_v1",
  )
  assert.match(heartbeatGate, /phase in \('succeeded', 'failed', 'skipped'\)/)
  assert.match(heartbeatGate, /latest\.phase = 'succeeded'/)
  assert.match(heartbeatGate, /order by heartbeat\.created_at desc, heartbeat\.id desc/)
  assert.match(heartbeatGate, /latch\.updated_at/)
  assert.match(heartbeatGate, /worker_id = 'notification-worker-route-v1'/)
  const workerRunGate = sqlFunctionBlock(
    source,
    "public.assert_notification_worker_run_allowed_v1",
  )
  assert.match(workerRunGate, /notification_worker_health_probes/)
  assert.doesNotMatch(workerRunGate, /record_notification_worker_heartbeat_v1/)
  assert.match(workerRunGate, /health_probe_recorded/)
  const recoveryHealth = sqlFunctionBlock(
    source,
    "dashboard_private.notification_recovery_health_fresh_v1",
  )
  assert.match(recoveryHealth, /notification_worker_health_probes/)
  assert.match(recoveryHealth, /latch\.updated_at/)
  assert.match(recoveryHealth, /worker_id = 'notification-worker-route-v1'/)
  const latchClear = sqlFunctionBlock(
    source,
    "dashboard_private.clear_notification_worker_stop_latch_v1_impl",
  )
  assert.match(latchClear, /notification_recovery_health_fresh_v1/)
  assert.match(latchClear, /notification_recovery_metrics_clean_v1/)
  const flagGate = sqlFunctionBlock(
    source,
    "dashboard_private.enforce_notification_flag_activation_v1",
  )
  assert.match(flagGate, /notification_shadow_phase_invalid/)
  assert.match(flagGate, /notification_dispatch_phase_invalid/)
  assert.match(flagGate, /owner_kind = 'canonical'/)
  assert.match(flagGate, /notification_control_plane_settings_ui_enabled/)
  const watchdog = sqlFunctionBlock(
    source,
    "dashboard_private.run_notification_cutover_watchdog_v1",
  )
  const leaseStart = watchdog.indexOf("if not pg_catalog.pg_try_advisory_xact_lock")
  const leaseEnd = watchdog.indexOf("end if;", leaseStart)
  const leaseBlock = watchdog.slice(leaseStart, leaseEnd)
  assert.match(leaseBlock, /lease_not_acquired/)
  assert.match(leaseBlock, /notification_watchdog_heartbeats/)
  assert.match(leaseBlock, /'skipped'/)

  const marker = source.lastIndexOf("create or replace function public.notification_workflow_adapters_runtime_version")
  const lastObject = Math.max(
    source.lastIndexOf("create or replace function "),
    source.lastIndexOf("create table "),
    source.lastIndexOf("create trigger "),
    source.lastIndexOf("create index "),
  )
  assert.equal(marker, lastObject)
})

test("shadow inbox 중단 지표는 삽입 시점의 불변 audit snapshot만 집계한다", async () => {
  const source = await readFile(scheduleMigrationUrl, "utf8")
  const projectionAudit = sqlFunctionBlock(
    source,
    "dashboard_private.audit_notification_inbox_projection_v1",
  )
  const metrics = sqlFunctionBlock(
    source,
    "dashboard_private.notification_operations_metrics_v1",
  )
  const inboxCountStart = metrics.indexOf("select pg_catalog.count(*) into v_inbox_shadow")
  assert.notEqual(inboxCountStart, -1)
  const inboxCountEnd = metrics.indexOf("select pg_catalog.count(*) into v_duplicate", inboxCountStart)
  const inboxCount = metrics.slice(inboxCountStart, inboxCountEnd)

  assert.match(inboxCount, /dashboard_private\.notification_audit_logs audit/)
  assert.match(inboxCount, /audit\.action = 'inbox_projection_recorded'/)
  assert.match(inboxCount, /audit\.reason_code = 'canonical_inbox_in_shadow'/)
  assert.match(
    projectionAudit,
    /where flag_row\.flag_key = 'notification_control_plane_shadow_write_enabled'\s*for share of flag_row;/,
  )
  assert.match(
    projectionAudit,
    /case\s+when coalesce\(v_shadow_enabled, false\)\s+then 'canonical_inbox_in_shadow'/,
  )
  assert.doesNotMatch(
    projectionAudit,
    /and v_ownership\.owner_kind is distinct from 'legacy'/,
  )
})

test("ownership anomaly 지표는 scope dispatch flag에 맞는 owner를 정상으로 인정한다", async () => {
  const source = await readFile(scheduleMigrationUrl, "utf8")
  const metrics = sqlFunctionBlock(
    source,
    "dashboard_private.notification_operations_metrics_v1",
  )
  const anomalyStart = metrics.indexOf("select pg_catalog.count(*) into v_ownership_anomaly")
  assert.notEqual(anomalyStart, -1)
  const anomalyEnd = metrics.indexOf(
    "select pg_catalog.count(*) into v_ownership_denial",
    anomalyStart,
  )
  const anomalyCount = metrics.slice(anomalyStart, anomalyEnd)

  assert.match(anomalyCount, /join dashboard_private\.notification_cutover_owners scope_owner/)
  assert.match(anomalyCount, /join dashboard_private\.notification_runtime_flags dispatch_flag/)
  assert.match(
    anomalyCount,
    /dispatch_flag\.enabled and ownership\.owner_kind <> 'canonical'/,
  )
  assert.match(
    anomalyCount,
    /not dispatch_flag\.enabled and ownership\.owner_kind <> 'legacy'/,
  )
})

test("ownership gate는 owner 종류를 강제하되 claim generation을 cutover revision으로 덮어쓰지 않는다", async () => {
  const source = await readFile(scheduleMigrationUrl, "utf8")
  const insertGate = sqlFunctionBlock(
    source,
    "dashboard_private.route_notification_ownership_insert_v1",
  )
  const dispatchGate = sqlFunctionBlock(
    source,
    "dashboard_private.enforce_notification_dispatch_runtime_gate_v1",
  )
  assert.match(insertGate, /new\.owner_kind\s*:=\s*'canonical'/)
  assert.match(insertGate, /new\.owner_kind\s*:=\s*'legacy'/)
  assert.doesNotMatch(insertGate, /new\.owner_generation\s*:=\s*v_owner\.revision/)
  assert.match(dispatchGate, /notification_cutover_owners/)
  assert.match(dispatchGate, /notification_runtime_flags/)
  assert.match(dispatchGate, /old\.owner_kind/)
  assert.match(dispatchGate, /new\.owner_generation\s+is\s+distinct\s+from\s+old\.owner_generation/i)
})

test("cutover activation과 flag trigger는 최종 forward-compat marker 없이는 fail-closed다", async () => {
  const [source, forward] = await Promise.all([
    readFile(scheduleMigrationUrl, "utf8"),
    readFile(forwardMigrationUrl, "utf8"),
  ])
  const activation = sqlFunctionBlock(
    source,
    "dashboard_private.activate_notification_dispatch_cutover_v1_impl",
  )
  const flagGate = sqlFunctionBlock(
    source,
    "dashboard_private.enforce_notification_flag_activation_v1",
  )
  assert.match(activation, /notification_runtime_dependency_ready_v1\('forward_compat'\)/)
  assert.match(
    activation,
    /notification_runtime_dependency_ready_v1\(\s*'registration_handoffs'\s*\)/,
  )
  assert.match(flagGate, /notification_runtime_dependency_ready_v1\('forward_compat'\)/)

  const dependency = sqlFunctionBlock(
    forward,
    "dashboard_private.notification_runtime_dependency_ready_v1",
  )
  assert.match(
    dependency,
    /when 'forward_compat' then 'notification_control_plane_forward_compat_runtime_version'/,
  )
  assert.match(
    dependency,
    /when 'registration_handoffs' then 'registration_notification_handoffs_runtime_version'/,
  )
  const marker = forward.lastIndexOf(
    "create or replace function public.notification_control_plane_forward_compat_runtime_version",
  )
  const lastObject = Math.max(
    forward.lastIndexOf("create or replace function "),
    forward.lastIndexOf("create table "),
    forward.lastIndexOf("create trigger "),
    forward.lastIndexOf("create index "),
  )
  assert.equal(marker, lastObject)
})

test("cutover activation은 DB에서 정확한 owner prefix와 바로 다음 scope만 허용한다", async () => {
  const source = await readFile(scheduleMigrationUrl, "utf8")
  const order = sqlFunctionBlock(
    source,
    "dashboard_private.notification_cutover_scope_order_v1",
  )
  for (const scope of [
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
  ]) assert.match(order, new RegExp(`'${scope}'`))

  const activation = sqlFunctionBlock(
    source,
    "dashboard_private.activate_notification_dispatch_cutover_v1_impl",
  )
  assert.match(activation, /array_position\(v_scope_order, p_scope_key\)/)
  assert.match(activation, /v_requested_position <> v_canonical_count \+ 1/)
  assert.match(activation, /unnest\(v_scope_order\)[\s\S]*with ordinality/)
  assert.match(activation, /expected\.ordinality < v_requested_position[\s\S]*owner_row\.owner_kind <> 'canonical'/)
  assert.match(activation, /expected\.ordinality >= v_requested_position[\s\S]*owner_row\.owner_kind <> 'legacy'/)
  assert.match(activation, /notification_cutover_order_invalid/)
  assert.match(activation, /interval '7 days'/)
  assert.match(activation, /notification_shadow_scope_evidence_complete_v1/)
  assert.match(activation, /lock table dashboard_private\.notification_rules in share mode/i)
  assert.match(activation, /lock table dashboard_private\.notification_templates in share mode/i)
  assert.match(activation, /notification_shadow_scope_config_digest_v1/)
  assert.match(activation, /scope_config_digests/)
  assert.match(activation, /notification_cutover_scope_config_changed/)
  assert.match(
    activation,
    /notification_current_contract_build_revision_hash_v1\(\s*v_build_evidence_since\s*\)/,
  )
  assert.match(activation, /notification_cutover_build_readiness_failed/)
  assert.match(activation, /notification_cutover_build_revision_changed/)
  assert.match(activation, /build_revision_hash/)
  assert.match(activation, /build_evidence_since/)

  const fixtureEvidence = sqlFunctionBlock(
    source,
    "public.record_notification_shadow_fixture_evidence_v1",
  )
  assert.match(fixtureEvidence, /notification_cutover_scope_order_v1/)
  assert.match(fixtureEvidence, /p_scope_key text,\s*p_request_id uuid/)
  assert.doesNotMatch(fixtureEvidence, /p_evidence_digest|p_completed_cycles/)
  assert.doesNotMatch(fixtureEvidence, /p_external_requests|p_canonical_inbox_projections/)
  assert.doesNotMatch(fixtureEvidence, /p_duplicate_external_requests/)
  assert.match(fixtureEvidence, /notification_shadow_comparison_current_v1/)
  assert.match(fixtureEvidence, /notification_shadow_fixture_evidence_unverified/)
  assert.match(fixtureEvidence, /notification_shadow_scope_config_digest_v1/)
  assert.match(fixtureEvidence, /shadow_fixture_cycle_verified/)

  const currentComparison = sqlFunctionBlock(
    source,
    "dashboard_private.notification_shadow_comparison_current_v1",
  )
  assert.match(currentComparison, /canonical_intent_recorded/)
  assert.match(currentComparison, /legacy_intent_recorded/)
  assert.match(currentComparison, /shadow_compare_result/)
  assert.match(currentComparison, /shadow_delivery_evaluated/)
  assert.match(currentComparison, /delivery\.status = 'skipped'/)
  assert.match(currentComparison, /delivery\.status_reason = 'shadow_mode'/)
  assert.match(currentComparison, /ownership\.state = 'closed'/)
  assert.match(currentComparison, /ownership\.terminal_outcome = 'sent'/)
  assert.match(currentComparison, /legacy_dispatch_finalized/)
  assert.doesNotMatch(currentComparison, /ownership\.state = 'reserved'/)
  assert.match(currentComparison, /rule_row\.revision/)
  assert.match(currentComparison, /rule_row\.active_template_id/)
  assert.match(currentComparison, /template_row\.checksum/)
  assert.match(currentComparison, /scoped_rule\.updated_at/)
  assert.match(currentComparison, /dashboard_notifications/)
  assert.match(currentComparison, /dispatch_started/)

  const scopeEvidence = sqlFunctionBlock(
    source,
    "dashboard_private.notification_shadow_scope_evidence_complete_v1",
  )
  assert.match(scopeEvidence, /notification_shadow_comparison/)
  assert.match(scopeEvidence, /shadow_compare_result/)
  assert.match(scopeEvidence, /notification_shadow_comparison_current_v1/)
  assert.doesNotMatch(scopeEvidence, /completed_cycles|external_requests/)
  assert.match(
    source,
    /revoke insert, update, delete, truncate\s+on table dashboard_private\.notification_audit_logs from service_role/i,
  )

  const currentBuild = sqlFunctionBlock(
    source,
    "dashboard_private.notification_current_contract_build_revision_hash_v1",
  )
  assert.match(currentBuild, /notification_contract_closures/)
  assert.match(currentBuild, /notification_contract_deployment_receipts/)
  assert.match(currentBuild, /p_since timestamp with time zone/)
  assert.match(currentBuild, /lag\(receipt\.observed_at\)/)
  assert.match(currentBuild, /count\(distinct receipt_rows\.build_revision_hash\)/)
  assert.match(currentBuild, /interval '5 minutes'/)
  assert.match(currentBuild, /v_maximum_gap_seconds > 600/)
  assert.match(currentBuild, /v_all_receipts_compliant/)
  assert.match(currentBuild, /pre_bridge_server_instances = 0/)
  assert.match(
    currentBuild,
    /bridge_aware_server_instances =\s*receipt_rows\.total_server_instances/,
  )
  assert.ok(
    currentBuild.indexOf("for update of state")
      < currentBuild.indexOf("v_now := pg_catalog.clock_timestamp()"),
  )
  assert.match(
    source,
    /revoke all on function dashboard_private\.notification_current_contract_build_revision_hash_v1\(\s*timestamp with time zone\s*\)\s+from public, anon, authenticated, service_role/i,
  )
})

test("legacy parity intent는 현재 active template이 아니라 canonical event의 불변 snapshot을 사용한다", async () => {
  const source = await readFile(scheduleMigrationUrl, "utf8")
  const intent = sqlFunctionBlock(source, "public.record_legacy_notification_intent_v1")
  assert.match(intent, /notification_events/)
  assert.match(intent, /rule_snapshot/)
  assert.match(intent, /template_id/)
  assert.match(intent, /template\.checksum|v_template\.checksum/)
  assert.doesNotMatch(intent, /active_template_id/)
})

test("forward shadow parity는 canonical·legacy 실제 intent를 정규화해 도착 순서와 무관하게 비교 기록한다", async () => {
  const source = await readFile(forwardMigrationUrl, "utf8")
  assert.match(source, /set\s+local\s+lock_timeout\s*=\s*'5s'/i)
  const hash = sqlFunctionBlock(
    source,
    "dashboard_private.notification_normalized_rendered_hash_v1",
  )
  assert.match(hash, /normalize[\s\S]*NFC/i)
  assert.match(hash, /E'\\r\\n'[\s\S]*E'\\n'/i)
  assert.match(hash, /\{"title":[\s\S]*"body":[\s\S]*"href":/i)
  assert.match(hash, /notification_sha256_hex_v1/i)
  assert.match(hash, /7c04d55426e204778748e9f7d310481fc10356103673d40edf50b0da5c1fa08e/i)

  const materialize = sqlFunctionBlock(
    source,
    "dashboard_private.materialize_notification_delivery_v1",
  )
  assert.match(materialize, /shadow_delivery_evaluated/i)
  assert.match(materialize, /canonical_intent_recorded/i)
  assert.match(materialize, /notification_compare_shadow_intent_v1/i)

  const legacy = sqlFunctionBlock(source, "public.record_legacy_notification_intent_v1")
  assert.match(legacy, /notification_events/i)
  assert.match(legacy, /rule_snapshot/i)
  assert.match(legacy, /template_checksum/i)
  assert.match(legacy, /legacy_intent_recorded/i)
  assert.match(legacy, /notification_compare_shadow_intent_v1/i)

  const compare = sqlFunctionBlock(
    source,
    "dashboard_private.notification_compare_shadow_intent_v1",
  )
  assert.match(compare, /pg_advisory_xact_lock/i)
  assert.match(compare, /canonical_intent_recorded/i)
  assert.match(compare, /legacy_intent_recorded/i)
  assert.match(compare, /shadow_compare_result/i)
  assert.match(compare, /matched/i)
  assert.match(compare, /template_mismatch/i)
  assert.match(compare, /render_mismatch/i)
  assert.doesNotMatch(compare, /rendered_title|rendered_body|webhook|endpoint|phone/i)
})

test("legacy intent 신규 overload는 실제 legacy plan checksum을 canonical snapshot과 분리해 검증·fingerprint·audit에 사용한다", async () => {
  const source = await readFile(forwardMigrationUrl, "utf8")
  assert.match(
    source,
    /create or replace function public\.record_legacy_notification_intent_v1\([\s\S]*?p_legacy_template_checksum text[\s\S]*?p_normalized_rendered_hash text[\s\S]*?\) returns jsonb/,
  )
  assert.match(source, /p_legacy_template_checksum\s*!~\s*'\^\[a-f0-9\]\{64\}\$'/)
  assert.match(source, /E'\\x1f'[\s\S]*p_legacy_template_checksum[\s\S]*p_normalized_rendered_hash/)
  assert.match(source, /'template_checksum',\s*p_legacy_template_checksum/)
  assert.match(source, /'canonical_template_checksum',\s*v_template\.checksum/)
  assert.match(
    source,
    /create or replace function public\.record_legacy_notification_intent_v1\([\s\S]*?p_target_generation bigint,[\s\S]*?p_normalized_rendered_hash text,[\s\S]*?p_request_id uuid[\s\S]*?return public\.record_legacy_notification_intent_v1\(/,
  )
  assert.match(
    source,
    /create or replace function public\.record_legacy_notification_delivery_intent_v1\([\s\S]*?p_delivery_id uuid,[\s\S]*?p_legacy_template_checksum text,[\s\S]*?p_normalized_rendered_hash text/,
  )
  assert.match(
    source,
    /create or replace function public\.record_legacy_notification_delivery_intent_v1\(\s*p_delivery_id uuid,\s*p_normalized_rendered_hash text,\s*p_request_id uuid[\s\S]*?return public\.record_legacy_notification_delivery_intent_v1\(\s*p_delivery_id,\s*v_template_checksum,/,
  )
  assert.match(
    source,
    /grant execute on function public\.record_legacy_notification_intent_v1\(\s*text, text, uuid, text, text, bigint, text, text, uuid\s*\) to service_role/,
  )
  assert.match(
    source,
    /grant execute on function public\.record_legacy_notification_delivery_intent_v1\(\s*uuid, text, text, uuid\s*\) to service_role/,
  )
})

test("forward shadow parity는 fanout 종료와 grace 뒤 누락·초과·대상 차이를 mismatch audit로 승격한다", async () => {
  const source = await readFile(forwardMigrationUrl, "utf8")
  const reconcile = sqlFunctionBlock(
    source,
    "dashboard_private.reconcile_notification_shadow_intents_v1",
  )
  assert.match(reconcile, /interval '5 minutes'/i)
  assert.match(reconcile, /pg_advisory_xact_lock/i)
  assert.match(reconcile, /notification_event_fanout_jobs/i)
  assert.match(reconcile, /status\s+in\s*\('pending',\s*'claimed'\)/i)
  for (const reason of [
    "missing_legacy_intent",
    "extra_legacy_intent",
    "channel_mismatch",
    "target_mismatch",
    "target_generation_mismatch",
  ]) assert.match(reconcile, new RegExp(reason))
  assert.match(reconcile, /shadow_compare_result/i)
  assert.match(reconcile, /if\s+not\s+exists[\s\S]*entity_id\s*=\s*v_result_id/i)
  assert.doesNotMatch(reconcile, /on\s+conflict\s+do\s+nothing/i)

  const gate = sqlFunctionBlock(source, "public.assert_notification_worker_run_allowed_v1")
  assert.match(gate, /reconcile_notification_shadow_intents_v1/i)
})

test("private cutover 구현은 직접 실행이 닫히고 rollback 실패가 watchdog 성공으로 지워지지 않는다", async () => {
  const source = await readFile(scheduleMigrationUrl, "utf8")
  const normalized = source.replace(/\s+/g, " ")
  for (const signature of [
    "dashboard_private.activate_notification_dispatch_cutover_v1_impl(text, text, jsonb, uuid)",
    "dashboard_private.abort_notification_shadow_v1_impl(jsonb, uuid, text)",
    "dashboard_private.rollback_notification_dispatch_cutover_v1_impl(text, text[], jsonb, boolean, uuid, text)",
    "dashboard_private.clear_notification_worker_stop_latch_v1_impl(bigint, uuid, text)",
    "dashboard_private.raise_notification_worker_stop_latch_v1(text)",
  ]) {
    assert.equal(
      normalized.toLowerCase().includes(
        `revoke all on function ${signature} from public, anon, authenticated, service_role`.toLowerCase(),
      ),
      true,
      `${signature} 직접 실행 권한이 닫혀야 합니다.`,
    )
  }
  const watchdog = sqlFunctionBlock(
    source,
    "dashboard_private.run_notification_cutover_watchdog_v1",
  )
  assert.match(watchdog, /rollback_failed_count/)
  assert.match(watchdog, /notification_watchdog_fault_scope_unknown/)
})
