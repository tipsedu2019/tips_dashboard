import assert from "node:assert/strict"
import test from "node:test"

import {
  createProductionRegistrationCustomerMessageRouteHandlers,
} from "../src/features/tasks/server/registration-customer-message-route.ts"
import { SOLAPI_SEND_MANY_URL } from "../src/features/tasks/server/registration-customer-message-solapi.ts"

const IDS = Object.freeze({
  actor: "d6300000-0000-4000-8000-000000000001",
  task: "d6300000-0000-4000-8000-000000000010",
  track: "d6300000-0000-4000-8000-000000000011",
  appointment: "d6300000-0000-4000-8000-000000000012",
  observation: "d6300000-0000-4000-8000-000000000013",
  session: "d6300000-0000-4000-8000-000000000014",
  preview: "d6300000-0000-4000-8000-000000000015",
  message: "d6300000-0000-4000-8000-000000000016",
  claim: "d6300000-0000-4000-8000-000000000017",
  dispatch: "d6300000-0000-4000-8000-000000000018",
  request: "d6300000-0000-4000-8000-000000000019",
  racePreview: "d6300000-0000-4000-8000-000000000020",
  raceMessage: "d6300000-0000-4000-8000-000000000021",
  raceClaim: "d6300000-0000-4000-8000-000000000022",
  raceDispatch: "d6300000-0000-4000-8000-000000000023",
  raceRequest: "d6300000-0000-4000-8000-000000000024",
})

const OBSERVATION_BOOKING_TARGET = Object.freeze({
  messageKind: "observation_booking",
  sourceId: IDS.observation,
})

const RAW_SOURCE = Object.freeze({
  messageKind: "observation_booking",
  sourceId: IDS.observation,
  taskId: IDS.task,
  trackId: IDS.track,
  observationId: IDS.observation,
  appointmentId: IDS.appointment,
  sourceRevision: 4,
  sessionSourceRevision: Object.freeze({
    authority: "normalized",
    sessionId: IDS.session,
    revision: 7,
  }),
  bookingFactHash: "a".repeat(64),
  studentName: "SOLAPI 테스트",
  parentPhoneDigits: "01012345678",
  subject: "영어",
  className: "중2 영어 A반",
  scheduledAt: "2026-08-17T09:00:00Z",
  place: "본관 301호",
  campus: "본관",
  teacherName: "홍길동",
})

const FIXED_ENV = Object.freeze({
  SOLAPI_API_KEY: "local-test-api-key",
  SOLAPI_API_SECRET: "local-test-api-secret",
  SOLAPI_KAKAO_PF_ID: "local-test-pf",
  SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_TEMPLATE_ID: "legacy-level",
  SOLAPI_REGISTRATION_VISIT_BOOKING_TEMPLATE_ID: "legacy-visit",
  SOLAPI_REGISTRATION_APPOINTMENT_REMINDER_TEMPLATE_ID: "legacy-reminder",
  SOLAPI_REGISTRATION_WAITING_TEMPLATE_ID: "legacy-waiting",
  SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID: "legacy-admission",
  SOLAPI_REGISTRATION_OBSERVATION_BOOKING_TEMPLATE_ID: "observation-booking",
  SOLAPI_REGISTRATION_OBSERVATION_REMINDER_TEMPLATE_ID: "observation-reminder",
  REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER: "local-observation-pepper",
})

function operatorRequest(path, body) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      authorization: "Bearer local-operator",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

function readiness(runtimeVersion, activationMode, extraBlockers = []) {
  const activationEligible = activationMode === "live"
  const blockers = [
    ...(runtimeVersion === 1 ? [] : ["runtime_not_ready"]),
    ...(activationMode === "off" ? ["activation_off"] : []),
    ...(activationMode === "verification" ? ["verification_scope_mismatch"] : []),
    ...extraBlockers,
  ]
  return {
    runtimeReady: runtimeVersion === 1,
    activationMode,
    activationEligible,
    credentialsConfigured: true,
    pfConfigured: true,
    templateConfigured: true,
    templateVerified: true,
    verifiedAt: "2026-08-12T00:00:00.000Z",
    sourceValid: true,
    sendAllowed: blockers.length === 0 && activationEligible,
    blockers,
  }
}

function sendResult(state, overrides = {}) {
  return {
    ok: state.status === "accepted",
    messageId: state.messageId,
    messageKind: "observation_booking",
    currentStatus: state.status,
    recipientLast4: "5678",
    confirmedByName: "김관리",
    confirmedAt: "2026-08-12T01:00:00.000Z",
    updatedAt: "2026-08-12T01:00:01.000Z",
    canCheck: state.status === "unknown",
    idempotent: false,
    ...overrides,
  }
}

function createObservationProductionHarness({
  runtimeVersion = 0,
  activationMode = "off",
  readinessBlockers = [],
  providerOutcome = "accepted",
  interleavedHistory = false,
} = {}) {
  const calls = {
    actorTables: [],
    authorizedTaskIds: [],
    rpcNames: [],
    providerSend: 0,
    marker: 0,
    release: 0,
    currentHistoryFilters: [],
  }
  const previews = new Map()
  const messages = new Map()
  let nextPreviewId = IDS.preview
  let nextMessageId = IDS.message
  let nextClaimId = IDS.claim
  let nextDispatchId = IDS.dispatch
  let committedRuntimeVersion = runtimeVersion
  let currentActivationMode = activationMode
  let currentRawSource = structuredClone(RAW_SOURCE)
  let sourceIneligible = false
  let runtimeBeforeNextMarker = null
  let currentContractIdentity = null

  const actorClient = {
    from(table) {
      calls.actorTables.push(table)
      const filters = []
      return {
        select(columns) {
          assert.equal(columns, "task_id")
          return this
        },
        eq(column, value) {
          filters.push([column, value])
          return this
        },
        async maybeSingle() {
          assert.deepEqual(filters, [["id", IDS.observation]])
          return table === "ops_registration_observations"
            ? { data: { task_id: IDS.task }, error: null }
            : { data: null, error: { code: "wrong_source_table" } }
        },
      }
    },
  }

  const serviceClient = {
    from(table) {
      if (table === "ops_registration_customer_messages") {
        const filters = []
        const orders = []
        return {
          select(columns) {
            assert.match(columns, /source_fingerprint/)
            return this
          },
          eq(column, value) {
            filters.push([column, value])
            return this
          },
          order(column, options) {
            orders.push([column, options])
            return this
          },
          async limit(value) {
            assert.equal(value, 1)
            assert.deepEqual(filters, [
              ["task_id", IDS.task],
              ["observation_id", IDS.observation],
              ["message_kind", "observation_booking"],
              ["source_revision", currentRawSource.sourceRevision],
              ["source_fingerprint", currentContractIdentity.sourceFingerprint],
              ["recipient_hash", currentContractIdentity.recipientHash],
            ])
            assert.deepEqual(orders, [
              ["created_at", { ascending: false }],
              ["id", { ascending: false }],
            ])
            calls.currentHistoryFilters.push(...filters)
            if (!interleavedHistory) {
              return {
                data: [...messages.values()]
                  .filter((state) => state.sourceFingerprint === currentContractIdentity.sourceFingerprint)
                  .slice(-value)
                  .reverse()
                  .map((state) => ({
                    id: state.messageId,
                    message_kind: "observation_booking",
                    status: state.status,
                    confirmed_by: IDS.actor,
                    confirmed_at: "2026-08-12T01:00:00.000Z",
                    updated_at: "2026-08-12T01:00:01.000Z",
                    recipient_last4: "5678",
                    provider_attempt_count: state.status === "pending" ? 0 : 1,
                    provider_attempt_started_at: state.status === "pending"
                      ? null
                      : "2026-08-12T00:00:00.000Z",
                    delivery_origin: "manual",
                  })),
                error: null,
              }
            }
            return {
              data: [{
                id: IDS.message,
                message_kind: "observation_booking",
                status: "unknown",
                confirmed_by: IDS.actor,
                confirmed_at: "2026-08-12T02:00:00.000Z",
                updated_at: "2026-08-12T02:01:00.000Z",
                recipient_last4: "5678",
                provider_attempt_count: 1,
                provider_attempt_started_at: "2000-01-01T00:00:00.000Z",
                delivery_origin: "manual",
              }],
              error: null,
            }
          },
        }
      }
      if (table === "profiles") {
        return {
          select(columns) {
            assert.equal(columns, "id,name")
            return this
          },
          async in(column, values) {
            assert.equal(column, "id")
            assert.deepEqual(values, [IDS.actor])
            return { data: [{ id: IDS.actor, name: "현재 담당자" }], error: null }
          },
        }
      }
      throw new Error(`unexpected observation production table: ${table}`)
    },
    async rpc(name, args) {
      calls.rpcNames.push(name)
      if (name === "resolve_registration_customer_message_source_v1") {
        assert.equal(args.p_message_kind, "observation_booking")
        assert.equal(args.p_source_id, IDS.observation)
        if (sourceIneligible) {
          return {
            data: null,
            error: { code: "22023", message: "registration_customer_message_source_ineligible" },
          }
        }
        return { data: structuredClone(currentRawSource), error: null }
      }
      if (name === "get_registration_customer_solapi_readiness_v1") {
        currentContractIdentity = {
          sourceFingerprint: args.p_template_contract.sourceFingerprint,
          recipientHash: args.p_template_contract.recipientHash,
        }
        const duplicateLocked = [...messages.values()].some(
          (state) => state.sourceFingerprint === args.p_template_contract.sourceFingerprint,
        ) || interleavedHistory
        return {
          data: readiness(committedRuntimeVersion, currentActivationMode, [
            ...readinessBlockers,
            ...(duplicateLocked ? ["duplicate_locked"] : []),
          ]),
          error: null,
        }
      }
      if (name === "list_registration_customer_messages_v1") {
        if (interleavedHistory) {
          return {
            data: [{
              messageId: IDS.raceMessage,
              messageKind: "observation_booking",
              currentStatus: "accepted",
              confirmedByName: "이전 담당자",
              confirmedAt: "2026-08-12T00:00:00.000Z",
              updatedAt: "2026-08-12T00:01:00.000Z",
              recipientLast4: "5678",
              canCheck: false,
            }],
            error: null,
          }
        }
        const history = [...messages.values()].map((state) => ({
          messageId: state.messageId,
          messageKind: "observation_booking",
          currentStatus: state.status,
          confirmedByName: "김관리",
          confirmedAt: "2026-08-12T01:00:00.000Z",
          updatedAt: "2026-08-12T01:00:01.000Z",
          recipientLast4: "5678",
          canCheck: state.status === "unknown",
        }))
        return { data: history.reverse(), error: null }
      }
      if (name === "create_registration_customer_message_preview_v1") {
        const previewId = nextPreviewId
        previews.set(previewId, {
          previewId,
          contract: structuredClone(args.p_contract),
        })
        return {
          data: {
            previewId,
            expiresAt: "2099-08-12T01:10:00.000Z",
            messageKind: "observation_booking",
            recipientLast4: "5678",
          },
          error: null,
        }
      }
      if (name === "read_registration_customer_message_preview_target_v1") {
        if (!previews.has(args.p_preview_id)) return { data: null, error: { code: "P0002" } }
        return { data: { ...OBSERVATION_BOOKING_TARGET, taskId: IDS.task }, error: null }
      }
      if (name === "claim_registration_customer_message_v1") {
        const replay = messages.get(args.p_request_key)
        if (replay) return { data: sendResult(replay, { idempotent: true, owner: false }), error: null }
        const preview = previews.get(args.p_preview_id)
        if (!preview) return { data: null, error: { code: "P0002" } }
        if (JSON.stringify(preview.contract) !== JSON.stringify(args.p_contract)) {
          return { data: null, error: { code: "40001", message: "registration_customer_message_preview_stale" } }
        }
        const state = {
          messageId: nextMessageId,
          status: "pending",
          claimToken: nextClaimId,
          dispatchToken: nextDispatchId,
          sourceFingerprint: args.p_contract.sourceFingerprint,
        }
        messages.set(args.p_request_key, state)
        return {
          data: sendResult(state, {
            owner: true,
            claimToken: state.claimToken,
            dispatchToken: state.dispatchToken,
          }),
          error: null,
        }
      }
      if (name === "mark_registration_customer_message_attempt_started_v1") {
        if (runtimeBeforeNextMarker !== null) {
          committedRuntimeVersion = runtimeBeforeNextMarker
          runtimeBeforeNextMarker = null
        }
        if (committedRuntimeVersion !== 1) {
          return {
            data: null,
            error: { code: "P0001", message: "registration_observation_runtime_not_ready" },
          }
        }
        calls.marker += 1
        return {
          data: {
            allowed: true,
            messageId: args.p_message_id,
            currentStatus: "pending",
            dispatchToken: args.p_dispatch_token,
          },
          error: null,
        }
      }
      if (name === "release_registration_customer_message_pre_send_claim_v1") {
        calls.release += 1
        return { data: { released: true }, error: null }
      }
      if (name === "finalize_registration_customer_message_v1") {
        const state = [...messages.values()].find((value) => value.messageId === args.p_message_id)
        assert.ok(state)
        state.status = args.p_result
        return { data: sendResult(state), error: null }
      }
      throw new Error(`unexpected observation production RPC: ${name}`)
    },
  }

  const auth = {
    async authenticate() {
      return {
        actorProfileId: IDS.actor,
        role: "staff",
        actorClient,
        serviceClient,
      }
    },
    async authorizeTask(_context, taskId) {
      calls.authorizedTaskIds.push(taskId)
      return taskId === IDS.task
    },
  }

  const providerFetch = async (url, init) => {
    assert.equal(String(url), SOLAPI_SEND_MANY_URL)
    assert.equal(init.method, "POST")
    calls.providerSend += 1
    const body = JSON.parse(init.body)
    assert.equal(body.messages[0].to, "01012345678")
    assert.equal(body.messages[0].kakaoOptions.templateId, "observation-booking")
    assert.equal(body.messages[0].kakaoOptions.disableSms, true)
    assert.deepEqual(Object.keys(body.messages[0].kakaoOptions.variables).sort(), [
      "#{과목}",
      "#{담당선생님}",
      "#{수업명}",
      "#{예약일시}",
      "#{장소}",
      "#{학생명}",
      "#{학원위치URL}",
    ].sort())
    if (providerOutcome === "unknown") return new Response(null, { status: 202 })
    return Response.json({
      groupInfo: { groupId: "synthetic-group" },
      messageList: [{ messageId: "synthetic-message", statusCode: "2000", statusMessage: "accepted" }],
    })
  }

  return {
    calls,
    handlers: createProductionRegistrationCustomerMessageRouteHandlers({
      auth,
      environment: FIXED_ENV,
      providerFetch,
    }),
    enableSend() {
      committedRuntimeVersion = 1
      currentActivationMode = "live"
    },
    commitRuntimeBeforeNextMarker(version) {
      runtimeBeforeNextMarker = version
    },
    useRaceIds() {
      nextPreviewId = IDS.racePreview
      nextMessageId = IDS.raceMessage
      nextClaimId = IDS.raceClaim
      nextDispatchId = IDS.raceDispatch
    },
    expirePreview(previewId) {
      previews.delete(previewId)
    },
    changeSource(change) {
      currentRawSource = { ...currentRawSource, ...change }
    },
    cancelSource() {
      sourceIneligible = true
    },
  }
}

test("production observation preview uses only the observation ID, canonical task, and public masked DTO", async () => {
  const harness = createObservationProductionHarness()
  const request = operatorRequest("/preview", OBSERVATION_BOOKING_TARGET)
  assert.deepEqual(await request.clone().json(), OBSERVATION_BOOKING_TARGET)

  const response = await harness.handlers.preview(request)
  const preview = await response.json()

  assert.equal(response.status, 200)
  assert.equal(preview.previewId, null)
  assert.equal(preview.recipientLast4, "5678")
  assert.equal(preview.readiness.sendAllowed, false)
  assert.deepEqual(preview.facts, {
    subjectLabel: "영어",
    className: "중2 영어 A반",
    scheduleLabel: "2026년 8월 17일 월요일 오후 6:00",
    placeLabel: "본관 301호",
    teacherLabel: "홍길동",
  })
  assert.deepEqual(preview.buttons, [{ name: "학원 위치 보기", type: "WL", host: "map.naver.com" }, { name: "문의하기", type: "WL", host: "tipsedu.channel.io" }])
  assert.deepEqual(harness.calls.actorTables, [])
  assert.deepEqual(harness.calls.authorizedTaskIds, [IDS.task])
  assert.equal(harness.calls.providerSend, 0)
  const serialized = JSON.stringify(preview)
  for (const forbidden of [
    "01012345678",
    IDS.appointment,
    IDS.track,
    "recipientHash",
    "sourceFingerprint",
    "학원위치URL",
    "map.naver.com/p/",
    "local-test-api-secret",
  ]) assert.equal(serialized.includes(forbidden), false, forbidden)
})

test("production observation confirmation calls the exact provider endpoint once and exact replay calls it zero more times", async () => {
  const harness = createObservationProductionHarness()
  harness.enableSend()

  const firstPreview = await harness.handlers.preview(operatorRequest("/preview", OBSERVATION_BOOKING_TARGET))
  const firstPreviewBody = await firstPreview.json()
  const secondPreview = await harness.handlers.preview(operatorRequest("/preview", OBSERVATION_BOOKING_TARGET))
  assert.equal(secondPreview.status, 200)
  assert.equal(harness.calls.providerSend, 0)

  const firstSend = await harness.handlers.send(operatorRequest("/send", {
    previewId: firstPreviewBody.previewId,
    requestKey: IDS.request,
  }))
  const firstResult = await firstSend.json()
  assert.equal(firstSend.status, 200)
  assert.equal(firstResult.currentStatus, "accepted")
  assert.equal(harness.calls.providerSend, 1)

  const replaySend = await harness.handlers.send(operatorRequest("/send", {
    previewId: firstPreviewBody.previewId,
    requestKey: IDS.request,
  }))
  const replayResult = await replaySend.json()
  assert.equal(replaySend.status, 200)
  assert.equal(replayResult.idempotent, true)
  assert.equal(harness.calls.providerSend, 1)
})

test("Gate B-R runtime-off interleaving releases the pre-send claim before any marker or provider call", async () => {
  const harness = createObservationProductionHarness()
  harness.enableSend()
  harness.useRaceIds()
  const previewResponse = await harness.handlers.preview(operatorRequest("/preview", OBSERVATION_BOOKING_TARGET))
  const preview = await previewResponse.json()
  assert.equal(previewResponse.status, 200)

  harness.commitRuntimeBeforeNextMarker(0)
  const sendResponse = await harness.handlers.send(operatorRequest("/send", {
    previewId: preview.previewId,
    requestKey: IDS.raceRequest,
  }))
  assert.equal(sendResponse.status, 503)
  assert.deepEqual(await sendResponse.json(), {
    ok: false,
    code: "registration_customer_message_pre_send_failed",
  })
  assert.equal(harness.calls.release, 1)
  assert.equal(harness.calls.marker, 0)
  assert.equal(harness.calls.providerSend, 0)
})

test("observation stale, canceled, revision, and booking-hash drift paths stay before the provider boundary", async () => {
  for (const [label, mutate, expectedStatus] of [
    ["stale preview", (harness, preview) => harness.expirePreview(preview.previewId), 409],
    ["canceled source", (harness) => harness.cancelSource(), 422],
    ["notification revision", (harness) => harness.changeSource({ sourceRevision: 5 }), 409],
    ["booking hash", (harness) => harness.changeSource({ bookingFactHash: "b".repeat(64) }), 409],
  ]) {
    const harness = createObservationProductionHarness({ runtimeVersion: 1, activationMode: "live" })
    const previewResponse = await harness.handlers.preview(operatorRequest("/preview", OBSERVATION_BOOKING_TARGET))
    const preview = await previewResponse.json()
    assert.equal(previewResponse.status, 200, label)
    mutate(harness, preview)
    const response = await harness.handlers.send(operatorRequest("/send", {
      previewId: preview.previewId,
      requestKey: IDS.request,
    }))
    assert.equal(response.status, expectedStatus, label)
    assert.equal(harness.calls.marker, 0, label)
    assert.equal(harness.calls.providerSend, 0, label)
  }
})

test("observation activation, verification, and template drift blockers create read-only previews with provider zero", async () => {
  for (const [label, configuration, blocker] of [
    ["activation off", { runtimeVersion: 1, activationMode: "off" }, "activation_off"],
    ["verification mismatch", { runtimeVersion: 1, activationMode: "verification" }, "verification_scope_mismatch"],
    ["template drift", { runtimeVersion: 1, activationMode: "live", readinessBlockers: ["template_drift"] }, "template_drift"],
  ]) {
    const harness = createObservationProductionHarness(configuration)
    const response = await harness.handlers.preview(operatorRequest("/preview", OBSERVATION_BOOKING_TARGET))
    const preview = await response.json()
    assert.equal(response.status, 200, label)
    assert.equal(preview.previewId, null, label)
    assert.equal(preview.readiness.sendAllowed, false, label)
    assert.equal(preview.readiness.blockers.includes(blocker), true, label)
    assert.equal(harness.calls.providerSend, 0, label)
  }
})

test("an ambiguous provider response is finalized unknown after exactly one provider call", async () => {
  const harness = createObservationProductionHarness({
    runtimeVersion: 1,
    activationMode: "live",
    providerOutcome: "unknown",
  })
  const previewResponse = await harness.handlers.preview(operatorRequest("/preview", OBSERVATION_BOOKING_TARGET))
  const preview = await previewResponse.json()
  const sendResponse = await harness.handlers.send(operatorRequest("/send", {
    previewId: preview.previewId,
    requestKey: IDS.request,
  }))
  const result = await sendResponse.json()
  assert.equal(sendResponse.status, 200)
  assert.equal(result.currentStatus, "unknown")
  assert.equal(result.ok, false)
  assert.equal(harness.calls.marker, 1)
  assert.equal(harness.calls.providerSend, 1)
})

test("a prior booking revision stays in history without locking a rescheduled revision preview", async () => {
  const harness = createObservationProductionHarness({ runtimeVersion: 1, activationMode: "live" })
  const firstPreviewResponse = await harness.handlers.preview(operatorRequest("/preview", OBSERVATION_BOOKING_TARGET))
  const firstPreview = await firstPreviewResponse.json()
  const firstSend = await harness.handlers.send(operatorRequest("/send", {
    previewId: firstPreview.previewId,
    requestKey: IDS.request,
  }))
  assert.equal(firstSend.status, 200)

  const sameRevisionResponse = await harness.handlers.preview(operatorRequest("/preview", OBSERVATION_BOOKING_TARGET))
  const sameRevision = await sameRevisionResponse.json()
  assert.equal(sameRevision.previewId, null)
  assert.equal(sameRevision.readiness.blockers.includes("duplicate_locked"), true)
  assert.equal(sameRevision.latestMessage.currentStatus, "accepted")

  harness.changeSource({ sourceRevision: 5 })
  const rescheduledResponse = await harness.handlers.preview(operatorRequest("/preview", OBSERVATION_BOOKING_TARGET))
  const rescheduled = await rescheduledResponse.json()
  assert.equal(rescheduledResponse.status, 200)
  assert.notEqual(rescheduled.previewId, null)
  assert.equal(rescheduled.readiness.blockers.includes("duplicate_locked"), false)
  assert.equal(rescheduled.latestMessage, null)
  assert.equal(harness.calls.providerSend, 1)
})

test("observation preview binds sender, time, and status to the current private contract before limiting history", async () => {
  const harness = createObservationProductionHarness({
    runtimeVersion: 1,
    activationMode: "live",
    interleavedHistory: true,
  })

  const response = await harness.handlers.preview(operatorRequest("/preview", OBSERVATION_BOOKING_TARGET))
  const preview = await response.json()

  assert.equal(response.status, 200)
  assert.equal(preview.previewId, null)
  assert.equal(preview.readiness.blockers.includes("duplicate_locked"), true)
  assert.deepEqual(preview.latestMessage, {
    messageId: IDS.message,
    messageKind: "observation_booking",
    currentStatus: "unknown",
    confirmedByName: "현재 담당자",
    confirmedAt: "2026-08-12T02:00:00.000Z",
    updatedAt: "2026-08-12T02:01:00.000Z",
    recipientLast4: "5678",
    canCheck: true,
  })
  assert.equal(harness.calls.currentHistoryFilters.length, 6)
  assert.equal(harness.calls.providerSend, 0)
})
