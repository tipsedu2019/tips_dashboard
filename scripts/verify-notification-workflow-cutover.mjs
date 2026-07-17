import { pathToFileURL } from "node:url"

export const NOTIFICATION_RUNTIME_FLAG_KEYS = Object.freeze([
  "notification_control_plane_settings_ui_enabled",
  "notification_control_plane_shadow_write_enabled",
  "notification_control_plane_dispatch_tasks_enabled",
  "notification_control_plane_dispatch_word_retests_enabled",
  "notification_control_plane_dispatch_registration_enabled",
  "notification_control_plane_registration_phone_adapter_enabled",
  "notification_control_plane_registration_visit_adapter_enabled",
  "notification_control_plane_registration_solapi_adapter_enabled",
  "notification_control_plane_dispatch_transfer_enabled",
  "notification_control_plane_dispatch_withdrawal_enabled",
  "notification_control_plane_dispatch_makeup_requests_enabled",
  "notification_control_plane_dispatch_approvals_enabled",
])

export const NOTIFICATION_CUTOVER_ORDER = Object.freeze([
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

const OWNER_FLAG = Object.freeze({
  tasks: "notification_control_plane_dispatch_tasks_enabled",
  word_retests: "notification_control_plane_dispatch_word_retests_enabled",
  approvals: "notification_control_plane_dispatch_approvals_enabled",
  transfer: "notification_control_plane_dispatch_transfer_enabled",
  withdrawal: "notification_control_plane_dispatch_withdrawal_enabled",
  makeup_requests: "notification_control_plane_dispatch_makeup_requests_enabled",
  registration: "notification_control_plane_dispatch_registration_enabled",
  registration_phone: "notification_control_plane_registration_phone_adapter_enabled",
  registration_visit: "notification_control_plane_registration_visit_adapter_enabled",
  registration_solapi: "notification_control_plane_registration_solapi_adapter_enabled",
})

const DECIMAL = /^(?:0|[1-9]\d*)$/
const CHECKSUM = /^[0-9a-f]{64}$/

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function heartbeatFresh(value, now) {
  const timestamp = new Date(value).getTime()
  const nowTimestamp = new Date(now).getTime()
  if (!Number.isFinite(timestamp) || !Number.isFinite(nowTimestamp)) return false
  const age = nowTimestamp - timestamp
  return age >= 0 && age < 180_000
}

function exactFlagRegistry(flags) {
  if (!isRecord(flags)) return false
  const keys = Object.keys(flags).sort()
  return keys.length === NOTIFICATION_RUNTIME_FLAG_KEYS.length
    && keys.every((key, index) => key === [...NOTIFICATION_RUNTIME_FLAG_KEYS].sort()[index])
    && Object.values(flags).every((value) => typeof value === "boolean")
}

function enabledOwners(flags) {
  return NOTIFICATION_CUTOVER_ORDER.filter((owner) => flags[OWNER_FLAG[owner]] === true)
}

function orderedOwnerPrefix(owners) {
  return owners.every((owner, index) => owner === NOTIFICATION_CUTOVER_ORDER[index])
}

const METRIC_BLOCKERS = Object.freeze([
  ["canonicalProviderRequestsInShadow", "canonical_provider_in_shadow"],
  ["canonicalInboxProjectionsInShadow", "canonical_inbox_in_shadow"],
  ["duplicateExternalAttempts", "duplicate_external_attempt"],
  ["newDeliveryUnknown", "delivery_unknown_detected"],
  ["scopeMismatchCount", "workflow_scope_mismatch"],
  ["zeroAudienceEnabledRuleCount", "enabled_rule_without_audience"],
  ["ownershipAnomalyCount", "ownership_anomaly"],
  ["shadowMismatchCount", "shadow_intent_mismatch"],
  ["rollbackFailedCount", "rollback_failed"],
])

export function verifyNotificationCutoverReadiness(evidence) {
  const blockers = []
  if (!isRecord(evidence) || !exactFlagRegistry(evidence.flags)) {
    blockers.push("runtime_flag_registry_invalid")
  }
  const markers = isRecord(evidence?.markers) ? evidence.markers : {}
  if (markers.common !== 1) blockers.push("common_runtime_marker_missing")
  if (markers.adapters !== 1) blockers.push("adapter_runtime_marker_missing")
  if (markers.registration !== 1) blockers.push("registration_runtime_marker_missing")
  if (evidence?.workerStopLatch !== false) blockers.push("worker_stop_latch_set")
  if (!heartbeatFresh(evidence?.workerHeartbeatAt, evidence?.now)) blockers.push("worker_heartbeat_stale")
  if (!heartbeatFresh(evidence?.watchdogHeartbeatAt, evidence?.now)) blockers.push("watchdog_heartbeat_stale")

  const flags = exactFlagRegistry(evidence?.flags) ? evidence.flags : {}
  const owners = enabledOwners(flags)
  if (!orderedOwnerPrefix(owners)) blockers.push("cutover_order_invalid")
  const metrics = isRecord(evidence?.metrics) ? evidence.metrics : {}
  for (const [field, code] of METRIC_BLOCKERS) {
    if (!Number.isInteger(metrics[field]) || metrics[field] < 0) {
      blockers.push("operations_metrics_invalid")
      break
    }
    if (metrics[field] > 0) blockers.push(code)
  }
  if (!Number.isFinite(metrics.pendingLagSeconds) || metrics.pendingLagSeconds < 0) {
    if (!blockers.includes("operations_metrics_invalid")) blockers.push("operations_metrics_invalid")
  } else if (metrics.pendingLagSeconds > 300) {
    blockers.push("queue_lag")
  }

  return {
    ready: blockers.length === 0,
    blockers,
    nextOwner: NOTIFICATION_CUTOVER_ORDER[owners.length] || null,
  }
}

function normalizeIntent(input) {
  if (!isRecord(input) || !DECIMAL.test(input.targetGeneration)) {
    throw new Error("target_generation_invalid")
  }
  if (!CHECKSUM.test(input.templateChecksum) || !CHECKSUM.test(input.normalizedRenderedContentHash)) {
    throw new Error("intent_checksum_invalid")
  }
  const keys = ["workflowKey", "eventKey", "occurrenceKey", "audienceKey", "channelKey", "targetKey"]
  if (keys.some((key) => typeof input[key] !== "string" || !input[key])) throw new Error("intent_identity_invalid")
  return Object.freeze({
    workflowKey: input.workflowKey,
    eventKey: input.eventKey,
    occurrenceKey: input.occurrenceKey,
    audienceKey: input.audienceKey,
    channelKey: input.channelKey,
    targetKey: input.targetKey,
    targetGeneration: input.targetGeneration,
    templateChecksum: input.templateChecksum,
    normalizedRenderedContentHash: input.normalizedRenderedContentHash,
  })
}

function identityKey(intent) {
  return [intent.workflowKey, intent.eventKey, intent.occurrenceKey, intent.audienceKey].join("\u001f")
}

function intentSortKey(intent) {
  return [identityKey(intent), intent.targetKey, intent.channelKey, intent.targetGeneration].join("\u001f")
}

export function compareNotificationShadowIntents(legacyIntents, canonicalIntents) {
  if (!Array.isArray(legacyIntents) || !Array.isArray(canonicalIntents)) throw new Error("intent_list_invalid")
  const expected = legacyIntents.map(normalizeIntent).sort((left, right) => intentSortKey(left).localeCompare(intentSortKey(right)))
  const actual = canonicalIntents.map(normalizeIntent).sort((left, right) => intentSortKey(left).localeCompare(intentSortKey(right)))
  const remaining = [...actual]
  const mismatches = []

  for (const left of expected) {
    const exactIndex = remaining.findIndex((right) => (
      intentSortKey(left) === intentSortKey(right)
      && left.templateChecksum === right.templateChecksum
      && left.normalizedRenderedContentHash === right.normalizedRenderedContentHash
    ))
    if (exactIndex >= 0) {
      remaining.splice(exactIndex, 1)
      continue
    }
    const relatedIndex = remaining.findIndex((right) => identityKey(left) === identityKey(right))
    if (relatedIndex < 0) {
      mismatches.push({ kind: "missing_event", expected: left })
      continue
    }
    const right = remaining.splice(relatedIndex, 1)[0]
    if (left.targetKey !== right.targetKey) mismatches.push({ kind: "target_mismatch", expected: left, actual: right })
    if (left.targetGeneration !== right.targetGeneration) mismatches.push({ kind: "target_generation_mismatch", expected: left, actual: right })
    if (left.channelKey !== right.channelKey) mismatches.push({ kind: "channel_mismatch", expected: left, actual: right })
    if (
      left.templateChecksum !== right.templateChecksum
      || left.normalizedRenderedContentHash !== right.normalizedRenderedContentHash
    ) mismatches.push({ kind: "template_mismatch", expected: left, actual: right })
  }
  for (const extra of remaining) mismatches.push({ kind: "extra_event", actual: extra })
  return { matched: mismatches.length === 0, mismatches }
}

const GLOBAL_FAULTS = new Set([
  "worker_heartbeat_stale",
  "watchdog_heartbeat_stale",
  "duplicate_external_attempt",
  "schedule_failure",
  "vault_policy_failure",
  "worker_route_failure",
  "cross_workflow_duplicate",
])
const LOCAL_FAULTS = new Set([
  "queue_lag",
  "delivery_unknown",
  "scope_mismatch",
  "zero_audience_rule",
  "ownership_anomaly",
  "shadow_mismatch",
])
const SHADOW_ABORT_FAULTS = new Set([
  "canonical_provider_in_shadow",
  "canonical_inbox_in_shadow",
  ...GLOBAL_FAULTS,
])

export function classifyNotificationCutoverFault(input) {
  if (!isRecord(input) || !["shadow", "cutover"].includes(input.phase)) throw new Error("fault_invalid")
  if (!NOTIFICATION_CUTOVER_ORDER.includes(input.owner)) throw new Error("fault_owner_invalid")
  if (input.phase === "shadow") {
    if (!SHADOW_ABORT_FAULTS.has(input.code) && !LOCAL_FAULTS.has(input.code)) throw new Error("fault_code_invalid")
    return { action: "abort_shadow", scope: "all", raiseStopLatch: SHADOW_ABORT_FAULTS.has(input.code) }
  }
  if (GLOBAL_FAULTS.has(input.code)) {
    return { action: "rollback_all_owners", scope: "all", raiseStopLatch: true }
  }
  if (LOCAL_FAULTS.has(input.code)) {
    return { action: "rollback_owner", scope: input.owner, raiseStopLatch: false }
  }
  throw new Error("fault_code_invalid")
}

function printDryRun() {
  process.stdout.write([
    "알림 전환 검증기: 읽기 전용 건식 실행",
    `검증 플래그: ${NOTIFICATION_RUNTIME_FLAG_KEYS.length}개`,
    `전환 순서: ${NOTIFICATION_CUTOVER_ORDER.join(" -> ")}`,
    "운영 플래그·스케줄·공급자·DB를 변경하지 않았습니다.",
    "실제 전환은 코드/미리보기 증거와 별도 승인이 모두 필요합니다.",
  ].join("\n") + "\n")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) printDryRun()
