import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const verifierUrl = new URL("../scripts/verify-notification-workflow-cutover.mjs", import.meta.url)
const documentUrl = new URL("../docs/operations/notification-workflow-cutover.md", import.meta.url)

function healthyEvidence(overrides = {}) {
  const now = "2026-07-17T12:00:00.000Z"
  return {
    now,
    flags: Object.fromEntries([
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
    ].map((key) => [key, false])),
    markers: { common: 1, adapters: 1, registration: 1 },
    workerStopLatch: false,
    workerHeartbeatAt: "2026-07-17T11:58:30.000Z",
    watchdogHeartbeatAt: "2026-07-17T11:58:45.000Z",
    metrics: {
      canonicalProviderRequestsInShadow: 0,
      canonicalInboxProjectionsInShadow: 0,
      duplicateExternalAttempts: 0,
      newDeliveryUnknown: 0,
      pendingLagSeconds: 0,
      scopeMismatchCount: 0,
      zeroAudienceEnabledRuleCount: 0,
      ownershipAnomalyCount: 0,
      shadowMismatchCount: 0,
      rollbackFailedCount: 0,
    },
    ...overrides,
  }
}

test("cutover registry and owner order are exact and all flags remain false", async () => {
  const verifier = await import(verifierUrl.href)
  assert.equal(verifier.NOTIFICATION_RUNTIME_FLAG_KEYS.length, 12)
  assert.deepEqual(verifier.NOTIFICATION_CUTOVER_ORDER, [
    "tasks", "word_retests", "approvals", "transfer", "withdrawal", "makeup_requests",
    "registration", "registration_phone", "registration_visit", "registration_solapi",
  ])
  assert.deepEqual(verifier.verifyNotificationCutoverReadiness(healthyEvidence()), {
    ready: true,
    blockers: [],
    nextOwner: "tasks",
  })
})

test("readiness fails closed on stale heartbeats, latch, flags, markers, and stop metrics", async () => {
  const verifier = await import(verifierUrl.href)
  const stale = verifier.verifyNotificationCutoverReadiness(healthyEvidence({
    workerStopLatch: true,
    workerHeartbeatAt: "2026-07-17T11:50:00.000Z",
    markers: { common: 1, adapters: 0, registration: 1 },
    flags: { notification_control_plane_settings_ui_enabled: false },
    metrics: { ...healthyEvidence().metrics, newDeliveryUnknown: 1 },
  }))
  assert.equal(stale.ready, false)
  assert.deepEqual(stale.blockers, [
    "runtime_flag_registry_invalid",
    "adapter_runtime_marker_missing",
    "worker_stop_latch_set",
    "worker_heartbeat_stale",
    "delivery_unknown_detected",
  ])
})

test("shadow comparison uses recipient generation and classifies every mismatch", async () => {
  const verifier = await import(verifierUrl.href)
  const base = {
    workflowKey: "tasks",
    eventKey: "task.created",
    occurrenceKey: "event-1",
    audienceKey: "management_team",
    channelKey: "google_chat",
    targetKey: "connection:google_chat.management",
    targetGeneration: "0",
    templateChecksum: "a".repeat(64),
    normalizedRenderedContentHash: "b".repeat(64),
  }
  assert.deepEqual(verifier.compareNotificationShadowIntents([base], [base]), { matched: true, mismatches: [] })
  const changed = { ...base, targetGeneration: "1", channelKey: "in_app" }
  const compared = verifier.compareNotificationShadowIntents([base], [changed])
  assert.equal(compared.matched, false)
  assert.deepEqual(compared.mismatches.map((item) => item.kind), ["target_generation_mismatch", "channel_mismatch"])
  assert.throws(
    () => verifier.compareNotificationShadowIntents([base], [{ ...base, targetGeneration: undefined, ownerGeneration: "0" }]),
    /target_generation_invalid/,
  )
})

test("fault classification chooses shadow abort, all-owner rollback, or one partial rollback", async () => {
  const verifier = await import(verifierUrl.href)
  assert.deepEqual(verifier.classifyNotificationCutoverFault({ phase: "shadow", code: "canonical_provider_in_shadow", owner: "tasks" }), {
    action: "abort_shadow",
    scope: "all",
    raiseStopLatch: true,
  })
  assert.deepEqual(verifier.classifyNotificationCutoverFault({ phase: "cutover", code: "worker_heartbeat_stale", owner: "tasks" }), {
    action: "rollback_all_owners",
    scope: "all",
    raiseStopLatch: true,
  })
  assert.deepEqual(verifier.classifyNotificationCutoverFault({ phase: "cutover", code: "queue_lag", owner: "withdrawal" }), {
    action: "rollback_owner",
    scope: "withdrawal",
    raiseStopLatch: false,
  })
})

test("verifier is read-only and Korean runbook preserves authorization and retention boundaries", async () => {
  const [source, document] = await Promise.all([
    readFile(verifierUrl, "utf8"),
    readFile(documentUrl, "utf8"),
  ])
  assert.doesNotMatch(source, /fetch\(|\.rpc\(|set_notification_runtime_flag|activate_notification_dispatch_cutover_v1\(/)
  for (const phrase of [
    "운영 플래그를 변경하지 않는다",
    "별도 승인",
    "14일",
    "부분 롤백",
    "전체 소유자 롤백",
    "전달 결과 불명",
  ]) assert.match(document, new RegExp(phrase))
})
