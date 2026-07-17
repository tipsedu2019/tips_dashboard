type JsonRecord = Record<string, unknown>

export type NotificationOperationsStopMetrics = Readonly<{
  canonicalProviderRequestsInShadow: number
  canonicalInboxProjectionsInShadow: number
  duplicateExternalAttempts: number
  newDeliveryUnknown: number
  pendingLagSeconds: number
  scopeMismatchCount: number
  zeroAudienceEnabledRuleCount: number
  ownershipAnomalyCount: number
  ownershipDenialCount: number
  shadowMismatchCount: number
  rollbackFailedCount: number
  missedWorkerHeartbeats: number
  scheduleContractFaultCount: number
  workerRouteFaultCount: number
}>

export type NotificationOperationsMetrics = Readonly<{
  generatedAt: string
  workerHeartbeatAt: string | null
  watchdogHeartbeatAt: string | null
  workerHeartbeatAgeSeconds: number | null
  watchdogHeartbeatAgeSeconds: number | null
  workerStopLatch: boolean
  workerStopLatchRevision: string
  queue: ReadonlyArray<Readonly<{
    workflowKey: string
    channelKey: string
    status: string
    count: number
    oldestPendingAgeSeconds: number
  }>>
  jobs: Readonly<{
    fanout: number
    ruleReconciliation: number
    targetReconciliation: number
  }>
  closedReasons: ReadonlyArray<Readonly<{
    workflowKey: string
    status: string
    statusReason: string | null
    count: number
  }>>
  ownershipDenialCount: number
  shadowComparison: Readonly<{
    matched: number
    mismatched: number
    matchRateBasisPoints: number
  }>
  stopMetrics: NotificationOperationsStopMetrics
}>

const TOP_LEVEL_KEYS = Object.freeze([
  "closed_reasons",
  "generated_at",
  "jobs",
  "ownership_denial_count",
  "queue",
  "shadow_comparison",
  "stop_metrics",
  "watchdog_heartbeat_at",
  "watchdog_heartbeat_age_seconds",
  "worker_heartbeat_at",
  "worker_heartbeat_age_seconds",
  "worker_stop_latch",
  "worker_stop_latch_revision",
])
const QUEUE_KEYS = Object.freeze([
  "channel_key",
  "count",
  "oldest_pending_age_seconds",
  "status",
  "workflow_key",
])
const CLOSED_REASON_KEYS = Object.freeze([
  "count",
  "status",
  "status_reason",
  "workflow_key",
])
const JOB_KEYS = Object.freeze([
  "fanout",
  "rule_reconciliation",
  "target_reconciliation",
])
const STOP_KEYS = Object.freeze([
  "canonical_inbox_projections_in_shadow",
  "canonical_provider_requests_in_shadow",
  "duplicate_external_attempts",
  "missed_worker_heartbeats",
  "new_delivery_unknown",
  "ownership_anomaly_count",
  "ownership_denial_count",
  "pending_lag_seconds",
  "rollback_failed_count",
  "schedule_contract_fault_count",
  "scope_mismatch_count",
  "shadow_mismatch_count",
  "zero_audience_enabled_rule_count",
  "worker_route_fault_count",
])
const SHADOW_KEYS = Object.freeze([
  "match_rate_basis_points",
  "matched",
  "mismatched",
])
const DECIMAL = /^(?:0|[1-9]\d*)$/
const WORKFLOWS = new Set([
  "tasks", "word_retests", "registration", "transfer", "withdrawal",
  "makeup_requests", "approvals",
])
const CHANNELS = new Set(["in_app", "web_push", "google_chat", "customer_message", "all"])

function fail(): never {
  throw new Error("notification_operations_metrics_invalid")
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: JsonRecord, expected: ReadonlyArray<string>) {
  const keys = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index])
}

function count(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail()
  return Number(value)
}

function nullableCount(value: unknown) {
  return value === null ? null : count(value)
}

function basisPoints(value: unknown) {
  const normalized = count(value)
  if (normalized > 10_000) fail()
  return normalized
}

function timestamp(value: unknown, nullable = false) {
  if (nullable && value === null) return null
  if (typeof value !== "string" || !value || !Number.isFinite(Date.parse(value))) fail()
  return value as string
}

function decimal(value: unknown) {
  if (typeof value !== "string" || !DECIMAL.test(value)) fail()
  return value
}

function queueRows(value: unknown) {
  if (!Array.isArray(value)) fail()
  return Object.freeze(value.map((row) => {
    if (!isRecord(row) || !hasExactKeys(row, QUEUE_KEYS)) fail()
    if (!WORKFLOWS.has(String(row.workflow_key)) || !CHANNELS.has(String(row.channel_key))) fail()
    if (typeof row.status !== "string" || !row.status) fail()
    return Object.freeze({
      workflowKey: String(row.workflow_key),
      channelKey: String(row.channel_key),
      status: row.status,
      count: count(row.count),
      oldestPendingAgeSeconds: count(row.oldest_pending_age_seconds),
    })
  }))
}

function closedReasonRows(value: unknown) {
  if (!Array.isArray(value)) fail()
  return Object.freeze(value.map((row) => {
    if (!isRecord(row) || !hasExactKeys(row, CLOSED_REASON_KEYS)) fail()
    if (!WORKFLOWS.has(String(row.workflow_key))) fail()
    if (typeof row.status !== "string" || !row.status) fail()
    if (row.status_reason !== null && (typeof row.status_reason !== "string" || !row.status_reason)) fail()
    return Object.freeze({
      workflowKey: String(row.workflow_key),
      status: row.status,
      statusReason: row.status_reason as string | null,
      count: count(row.count),
    })
  }))
}

export function normalizeNotificationOperationsMetrics(value: unknown): NotificationOperationsMetrics {
  if (!isRecord(value) || !hasExactKeys(value, TOP_LEVEL_KEYS)) fail()
  if (typeof value.worker_stop_latch !== "boolean") fail()
  if (!isRecord(value.jobs) || !hasExactKeys(value.jobs, JOB_KEYS)) fail()
  if (!isRecord(value.shadow_comparison) || !hasExactKeys(value.shadow_comparison, SHADOW_KEYS)) fail()
  if (!isRecord(value.stop_metrics) || !hasExactKeys(value.stop_metrics, STOP_KEYS)) fail()

  const stop = value.stop_metrics
  return Object.freeze({
    generatedAt: timestamp(value.generated_at) as string,
    workerHeartbeatAt: timestamp(value.worker_heartbeat_at, true),
    watchdogHeartbeatAt: timestamp(value.watchdog_heartbeat_at, true),
    workerHeartbeatAgeSeconds: nullableCount(value.worker_heartbeat_age_seconds),
    watchdogHeartbeatAgeSeconds: nullableCount(value.watchdog_heartbeat_age_seconds),
    workerStopLatch: value.worker_stop_latch,
    workerStopLatchRevision: decimal(value.worker_stop_latch_revision),
    queue: queueRows(value.queue),
    jobs: Object.freeze({
      fanout: count(value.jobs.fanout),
      ruleReconciliation: count(value.jobs.rule_reconciliation),
      targetReconciliation: count(value.jobs.target_reconciliation),
    }),
    closedReasons: closedReasonRows(value.closed_reasons),
    ownershipDenialCount: count(value.ownership_denial_count),
    shadowComparison: Object.freeze({
      matched: count(value.shadow_comparison.matched),
      mismatched: count(value.shadow_comparison.mismatched),
      matchRateBasisPoints: basisPoints(value.shadow_comparison.match_rate_basis_points),
    }),
    stopMetrics: Object.freeze({
      canonicalProviderRequestsInShadow: count(stop.canonical_provider_requests_in_shadow),
      canonicalInboxProjectionsInShadow: count(stop.canonical_inbox_projections_in_shadow),
      duplicateExternalAttempts: count(stop.duplicate_external_attempts),
      newDeliveryUnknown: count(stop.new_delivery_unknown),
      pendingLagSeconds: count(stop.pending_lag_seconds),
      scopeMismatchCount: count(stop.scope_mismatch_count),
      zeroAudienceEnabledRuleCount: count(stop.zero_audience_enabled_rule_count),
      ownershipAnomalyCount: count(stop.ownership_anomaly_count),
      ownershipDenialCount: count(stop.ownership_denial_count),
      shadowMismatchCount: count(stop.shadow_mismatch_count),
      rollbackFailedCount: count(stop.rollback_failed_count),
      missedWorkerHeartbeats: count(stop.missed_worker_heartbeats),
      scheduleContractFaultCount: count(stop.schedule_contract_fault_count),
      workerRouteFaultCount: count(stop.worker_route_fault_count),
    }),
  })
}

export function notificationOperationsBlockers(metrics: NotificationOperationsMetrics) {
  const stop = metrics.stopMetrics
  const blockers: string[] = []
  if (stop.canonicalProviderRequestsInShadow > 0) blockers.push("canonical_provider_in_shadow")
  if (stop.canonicalInboxProjectionsInShadow > 0) blockers.push("canonical_inbox_in_shadow")
  if (stop.duplicateExternalAttempts > 0) blockers.push("duplicate_external_attempt")
  if (stop.newDeliveryUnknown > 0) blockers.push("delivery_unknown_detected")
  if (stop.missedWorkerHeartbeats >= 3) blockers.push("worker_heartbeat_missed")
  if (stop.pendingLagSeconds > 300) blockers.push("queue_lag")
  if (stop.scopeMismatchCount > 0) blockers.push("workflow_scope_mismatch")
  if (stop.zeroAudienceEnabledRuleCount > 0) blockers.push("enabled_rule_without_audience")
  if (stop.ownershipAnomalyCount > 0) blockers.push("ownership_anomaly")
  if (stop.ownershipDenialCount > 0) blockers.push("ownership_denial_anomaly")
  if (stop.shadowMismatchCount > 0) blockers.push("shadow_intent_mismatch")
  if (stop.rollbackFailedCount > 0) blockers.push("rollback_failed")
  if (stop.scheduleContractFaultCount > 0) blockers.push("schedule_contract_fault")
  if (stop.workerRouteFaultCount > 0) blockers.push("worker_route_fault")
  return Object.freeze(blockers)
}

export function createNotificationOperationsMetricsReader(input: Readonly<{
  rpc(name: string, parameters?: Readonly<Record<string, never>>): Promise<unknown>
}>) {
  if (!input || typeof input.rpc !== "function") fail()
  return Object.freeze({
    async read() {
      return normalizeNotificationOperationsMetrics(
        await input.rpc("get_notification_operations_metrics_v1", {}),
      )
    },
  })
}
