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

export function verifyDeterministicNotificationShadowFixture(evidence) {
  const blockers = []
  if (!isRecord(evidence)) return { passed: false, blockers: ["shadow_fixture_invalid"] }

  const cycles = Array.isArray(evidence.cycles) ? evidence.cycles : []
  const owners = cycles.map((cycle) => cycle?.owner)
  if (
    owners.length !== NOTIFICATION_CUTOVER_ORDER.length
    || owners.some((owner, index) => owner !== NOTIFICATION_CUTOVER_ORDER[index])
  ) blockers.push("shadow_fixture_owner_cycle_incomplete")

  for (const cycle of cycles) {
    if (!isRecord(cycle) || cycle.complete !== true) {
      blockers.push("shadow_fixture_cycle_incomplete")
      continue
    }
    if (cycle.legacyTransport !== "injected_recorder" || !Number.isInteger(cycle.recordedLegacyIntents) || cycle.recordedLegacyIntents < 1) {
      blockers.push("legacy_recorder_invalid")
    }
    if (cycle.externalRequests !== 0) blockers.push("fixture_external_request_detected")
    if (cycle.canonicalInboxProjections !== 0) blockers.push("fixture_inbox_projection_detected")
    if (cycle.duplicateExternalRequests !== 0) blockers.push("fixture_duplicate_request_detected")
    if (
      !Array.isArray(cycle.canonicalRows)
      || cycle.canonicalRows.length < 1
      || cycle.canonicalRows.some((row) => (
        !isRecord(row)
        || row.status !== "skipped"
        || row.skipReason !== "shadow_mode"
        || row.replayable !== false
      ))
    ) blockers.push("canonical_shadow_row_invalid")
    if (
      Number.isInteger(cycle.enabledRuleWithoutAudienceCount)
      && cycle.enabledRuleWithoutAudienceCount > 0
      && cycle.zeroAudienceInvestigated !== true
    ) blockers.push("enabled_rule_without_audience")
  }

  return { passed: blockers.length === 0, blockers: [...new Set(blockers)] }
}

function cloneFixtureState(state) {
  return structuredClone(state)
}

function invalidRehearsal(state, error) {
  return { ok: false, error, state: cloneFixtureState(state) }
}

function validOwnerRegistry(flags) {
  return exactFlagRegistry(flags)
    && NOTIFICATION_CUTOVER_ORDER.every((owner) => typeof flags[OWNER_FLAG[owner]] === "boolean")
}

export function rehearseNotificationRollback(input) {
  if (!isRecord(input) || !isRecord(input.state)) throw new Error("rollback_fixture_invalid")
  const original = cloneFixtureState(input.state)
  const flags = input.state.flags
  const revisions = input.state.revisions
  const affectedOwners = input.affectedOwners
  const expectedRevisions = input.expectedRevisions

  if (!validOwnerRegistry(flags) || !isRecord(revisions)) return invalidRehearsal(original, "runtime_flag_registry_invalid")
  if (
    !Array.isArray(affectedOwners)
    || affectedOwners.length < 1
    || new Set(affectedOwners).size !== affectedOwners.length
    || affectedOwners.some((owner) => !NOTIFICATION_CUTOVER_ORDER.includes(owner))
  ) return invalidRehearsal(original, "rollback_owner_set_invalid")
  if (!isRecord(expectedRevisions) || Object.keys(expectedRevisions).sort().join("\u001f") !== [...affectedOwners].sort().join("\u001f")) {
    return invalidRehearsal(original, "rollback_revision_set_invalid")
  }
  for (const owner of affectedOwners) {
    const flag = OWNER_FLAG[owner]
    if (!Number.isInteger(revisions[flag]) || revisions[flag] < 0 || expectedRevisions[owner] !== revisions[flag]) {
      return invalidRehearsal(original, "rollback_revision_stale")
    }
  }

  const enabledOwnersBefore = enabledOwners(flags)
  if (affectedOwners.some((owner) => !enabledOwnersBefore.includes(owner))) {
    return invalidRehearsal(original, "rollback_owner_not_enabled")
  }
  const isAllOwnerRollback = enabledOwnersBefore.every((owner) => affectedOwners.includes(owner))
  if (input.reenableShadow === true && !isAllOwnerRollback) {
    return invalidRehearsal(original, "partial_rollback_cannot_enable_shadow")
  }

  const next = cloneFixtureState(input.state)
  for (const owner of affectedOwners) {
    const flag = OWNER_FLAG[owner]
    next.flags[flag] = false
    next.revisions[flag] += 1
  }
  const settingsFlag = "notification_control_plane_settings_ui_enabled"
  next.flags[settingsFlag] = false
  next.revisions[settingsFlag] += 1
  next.flags.notification_control_plane_shadow_write_enabled = input.reenableShadow === true

  let canceledCount = 0
  let cancelRequestedCount = 0
  next.deliveries = (Array.isArray(next.deliveries) ? next.deliveries : []).map((delivery) => {
    if (!affectedOwners.includes(delivery.owner)) return delivery
    if (["pending", "retry_wait"].includes(delivery.status)) {
      canceledCount += 1
      return { ...delivery, status: "canceled", cancellationReason: "cutover_rollback" }
    }
    if (delivery.status === "claimed" && delivery.dispatchStarted !== true && !delivery.providerReference) {
      cancelRequestedCount += 1
      return { ...delivery, cancelRequested: true, cancellationReason: "cutover_rollback" }
    }
    return delivery
  })

  return {
    ok: true,
    mode: isAllOwnerRollback ? "all_owner" : "partial",
    state: next,
    counts: {
      canceled: canceledCount,
      cancelRequested: cancelRequestedCount,
      awaitingClaimClosure: cancelRequestedCount,
    },
  }
}

export function rehearseNotificationOwnershipTransfer(input) {
  if (!isRecord(input) || !isRecord(input.claim)) throw new Error("ownership_fixture_invalid")
  const claim = cloneFixtureState(input.claim)
  const rejected = (error) => ({ ok: false, error, claim: cloneFixtureState(claim) })
  if (input.claimClosureConfirmed !== true) return rejected("claim_closure_not_confirmed")
  if (claim.status !== "reserved" || claim.dispatchStarted === true || claim.providerReference) {
    return rejected("ownership_not_transferable")
  }
  if (["sending", "sent", "delivery_unknown"].includes(claim.deliveryStatus)) {
    return rejected("ownership_not_transferable")
  }
  if (!DECIMAL.test(claim.ownerGeneration)) return rejected("owner_generation_invalid")
  return {
    ok: true,
    claim: {
      ...claim,
      owner: "legacy",
      ownerGeneration: (BigInt(claim.ownerGeneration) + 1n).toString(),
    },
  }
}

export function rehearseNotificationShadowAbort(state) {
  if (!isRecord(state) || !validOwnerRegistry(state.flags)) throw new Error("shadow_abort_fixture_invalid")
  const next = cloneFixtureState(state)
  for (const key of NOTIFICATION_RUNTIME_FLAG_KEYS) next.flags[key] = false
  next.workerStopLatch = true
  next.shadowAbortReason = "canonical_side_effect_in_shadow"
  return next
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
