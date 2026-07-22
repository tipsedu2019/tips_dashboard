import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const verifierUrl = new URL("../scripts/verify-notification-workflow-cutover.mjs", import.meta.url)
const documentUrl = new URL("../docs/operations/notification-workflow-cutover.md", import.meta.url)
const forwardCompatUrl = new URL(
  "../supabase/pending-migrations/notification-cutover/20260716195500_notification_worker_schedule.sql",
  import.meta.url,
)

test("shadow build 연속성 검사는 bridge 잠금 뒤 현재 시각을 다시 잡는다", async () => {
  const migration = await readFile(forwardCompatUrl, "utf8")
  const helperStart = migration.indexOf(
    "create or replace function dashboard_private.notification_current_contract_build_revision_hash_v1",
  )
  const helperEnd = migration.indexOf("create or replace function", helperStart + 1)
  const helper = migration.slice(helperStart, helperEnd)
  const lockIndex = helper.indexOf("for update")
  const nowIndex = helper.indexOf("v_now := pg_catalog.clock_timestamp()")
  const receiptIndex = helper.indexOf("notification_contract_deployment_receipts", nowIndex)
  assert.ok(helperStart >= 0 && lockIndex >= 0 && nowIndex > lockIndex && receiptIndex > nowIndex)
})

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
    markers: {
      common: 1,
      adapters: 1,
      registration: 1,
      registrationHandoffs: 1,
      forwardCompat: 1,
    },
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
      ownershipDenialCount: 0,
      shadowMismatchCount: 0,
      rollbackFailedCount: 0,
      missedWorkerHeartbeats: 0,
      scheduleContractFaultCount: 0,
      workerRouteFaultCount: 0,
    },
    ...overrides,
  }
}

function exactFlags(enabledOwners = []) {
  const flags = healthyEvidence().flags
  const ownerFlags = {
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
  }
  for (const owner of enabledOwners) flags[ownerFlags[owner]] = true
  return flags
}

function rollbackState(enabledOwners = ["tasks", "word_retests"]) {
  const flags = exactFlags(enabledOwners)
  flags.notification_control_plane_settings_ui_enabled = true
  return {
    flags,
    revisions: Object.fromEntries(Object.keys(flags).map((key) => [key, 4])),
    deliveries: [
      { id: "pending", owner: "word_retests", status: "pending" },
      { id: "retry", owner: "word_retests", status: "retry_wait" },
      { id: "claimed", owner: "word_retests", status: "claimed", dispatchStarted: false, providerReference: null },
      { id: "sending", owner: "word_retests", status: "sending", dispatchStarted: true },
      { id: "sent", owner: "word_retests", status: "sent", providerReference: "provider-ref" },
      { id: "failed", owner: "word_retests", status: "failed" },
      { id: "unknown", owner: "word_retests", status: "delivery_unknown", providerReference: "unknown-ref" },
      { id: "other-owner", owner: "tasks", status: "pending" },
    ],
    cancelRequests: [],
    workerStopLatch: false,
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
    markers: {
      common: 1,
      adapters: 0,
      registration: 1,
      registrationHandoffs: 0,
      forwardCompat: 0,
    },
    flags: { notification_control_plane_settings_ui_enabled: false },
    metrics: { ...healthyEvidence().metrics, newDeliveryUnknown: 1 },
  }))
  assert.equal(stale.ready, false)
  assert.deepEqual(stale.blockers, [
    "runtime_flag_registry_invalid",
    "adapter_runtime_marker_missing",
    "registration_handoffs_runtime_marker_missing",
    "forward_compat_runtime_marker_missing",
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

test("deterministic preview cycles every owner with recorder-only legacy and terminal canonical shadow rows", async () => {
  const verifier = await import(verifierUrl.href)
  const cycles = verifier.NOTIFICATION_CUTOVER_ORDER.map((owner) => ({
    owner,
    complete: true,
    legacyTransport: "injected_recorder",
    recordedLegacyIntents: 1,
    externalRequests: 0,
    canonicalInboxProjections: 0,
    duplicateExternalRequests: 0,
    enabledRuleWithoutAudienceCount: 0,
    canonicalRows: [{ status: "skipped", skipReason: "shadow_mode", replayable: false }],
  }))
  assert.deepEqual(verifier.verifyDeterministicNotificationShadowFixture({ cycles }), { passed: true, blockers: [] })

  const unsafe = structuredClone(cycles)
  unsafe[0].externalRequests = 1
  unsafe[0].canonicalRows[0].replayable = true
  assert.deepEqual(verifier.verifyDeterministicNotificationShadowFixture({ cycles: unsafe }), {
    passed: false,
    blockers: ["fixture_external_request_detected", "canonical_shadow_row_invalid"],
  })
})

test("every simulated rollout and rollback point has exactly one side-effect owner", async () => {
  const verifier = await import(verifierUrl.href)
  for (let index = 0; index <= verifier.NOTIFICATION_CUTOVER_ORDER.length; index += 1) {
    assert.deepEqual(verifier.verifyExclusiveNotificationOwnership({
      canonicalOwners: verifier.NOTIFICATION_CUTOVER_ORDER.slice(0, index),
      legacyOwners: verifier.NOTIFICATION_CUTOVER_ORDER.slice(index),
    }), { passed: true, blockers: [] })
  }
  assert.deepEqual(verifier.verifyExclusiveNotificationOwnership({
    canonicalOwners: ["tasks", "approvals"],
    legacyOwners: verifier.NOTIFICATION_CUTOVER_ORDER.filter((owner) => owner !== "tasks" && owner !== "approvals"),
  }), { passed: true, blockers: [] })
  const duplicate = verifier.verifyExclusiveNotificationOwnership({
    canonicalOwners: ["tasks"],
    legacyOwners: verifier.NOTIFICATION_CUTOVER_ORDER,
  })
  assert.equal(duplicate.passed, false)
  assert.deepEqual(duplicate.blockers, ["ownership_duplicate:tasks"])
})

test("partial rollback disables one owner and preserves canonical owners plus terminal delivery evidence", async () => {
  const verifier = await import(verifierUrl.href)
  const result = verifier.rehearseNotificationRollback({
    state: rollbackState(),
    affectedOwners: ["word_retests"],
    expectedRevisions: { word_retests: 4 },
    reenableShadow: false,
  })
  assert.equal(result.ok, true)
  assert.equal(result.mode, "partial")
  assert.equal(result.state.flags.notification_control_plane_dispatch_tasks_enabled, true)
  assert.equal(result.state.flags.notification_control_plane_dispatch_word_retests_enabled, false)
  assert.equal(result.state.flags.notification_control_plane_shadow_write_enabled, false)
  assert.deepEqual(result.counts, { canceled: 2, cancelRequested: 1, awaitingClaimClosure: 1 })
  assert.deepEqual(result.state.cancelRequests, [{ deliveryId: "claimed", reason: "cutover_rollback" }])
  assert.deepEqual(result.state.deliveries.map((item) => item.status), [
    "canceled", "canceled", "claimed", "sending", "sent", "failed", "delivery_unknown", "pending",
  ])
  assert.equal(result.state.deliveries[2].cancelRequested, true)
  assert.equal(result.state.deliveries[4].providerReference, "provider-ref")
  assert.equal(result.state.deliveries[6].providerReference, "unknown-ref")
})

test("all-owner rollback alone may restore shadow and invalid rollback is exactly unchanged", async () => {
  const verifier = await import(verifierUrl.href)
  const state = rollbackState()
  const all = verifier.rehearseNotificationRollback({
    state,
    affectedOwners: ["tasks", "word_retests"],
    expectedRevisions: { tasks: 4, word_retests: 4 },
    reenableShadow: true,
  })
  assert.equal(all.ok, true)
  assert.equal(all.mode, "all_owner")
  assert.equal(all.state.flags.notification_control_plane_shadow_write_enabled, true)

  for (const invalid of [
    { affectedOwners: ["word_retests", "unknown"], expectedRevisions: { word_retests: 4, unknown: 4 }, reenableShadow: false },
    { affectedOwners: ["word_retests"], expectedRevisions: { word_retests: 3 }, reenableShadow: false },
    { affectedOwners: ["word_retests"], expectedRevisions: { word_retests: 4 }, reenableShadow: true },
  ]) {
    const result = verifier.rehearseNotificationRollback({ state, ...invalid })
    assert.equal(result.ok, false)
    assert.deepEqual(result.state, state)
  }
})

test("ownership transfer waits for closure and rejects any started or provider-known claim", async () => {
  const verifier = await import(verifierUrl.href)
  const reserved = {
    id: "claim-1",
    owner: "canonical",
    ownerGeneration: "7",
    status: "reserved",
    dispatchStarted: false,
    providerReference: null,
    deliveryStatus: "pending",
  }
  assert.deepEqual(verifier.rehearseNotificationOwnershipTransfer({ claim: reserved, claimClosureConfirmed: true }), {
    ok: true,
    claim: { ...reserved, owner: "legacy", ownerGeneration: "8" },
  })
  for (const claim of [
    { ...reserved, dispatchStarted: true },
    { ...reserved, providerReference: "provider-ref" },
    { ...reserved, deliveryStatus: "sending" },
    { ...reserved, deliveryStatus: "sent" },
    { ...reserved, deliveryStatus: "delivery_unknown" },
  ]) {
    const result = verifier.rehearseNotificationOwnershipTransfer({ claim, claimClosureConfirmed: true })
    assert.equal(result.ok, false)
    assert.deepEqual(result.claim, claim)
  }
  assert.equal(verifier.rehearseNotificationOwnershipTransfer({ claim: reserved, claimClosureConfirmed: false }).ok, false)
})

test("shadow side effect aborts with every flag false, stop latch set, and no automatic shadow restore", async () => {
  const verifier = await import(verifierUrl.href)
  const state = rollbackState(["tasks"])
  state.flags.notification_control_plane_shadow_write_enabled = true
  const aborted = verifier.rehearseNotificationShadowAbort(state)
  assert.equal(Object.values(aborted.flags).every((value) => value === false), true)
  assert.equal(aborted.workerStopLatch, true)
  assert.equal(aborted.shadowAbortReason, "canonical_side_effect_in_shadow")
})

test("fault classification chooses shadow abort, all-owner rollback, or one partial rollback", async () => {
  const verifier = await import(verifierUrl.href)
  assert.deepEqual(verifier.classifyNotificationCutoverFault({ phase: "shadow", code: "canonical_provider_in_shadow", owner: "tasks" }), {
    action: "abort_shadow",
    scope: "all",
    raiseStopLatch: true,
  })
  assert.deepEqual(verifier.classifyNotificationCutoverFault({ phase: "cutover", code: "worker_heartbeat_missed", owner: "tasks" }), {
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
    "자기비교",
    "자연 발생 운영 비교",
    "no_active_rule",
    "합성 이벤트·전달·소유권 생성을 하지 않는다",
    "원자 롤백",
  ]) assert.match(document, new RegExp(phrase))
})
