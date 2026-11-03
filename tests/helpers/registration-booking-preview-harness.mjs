import assert from "node:assert/strict"

import { createRegistrationCustomerMessageCatalog } from "../../src/features/tasks/server/registration-customer-message-catalog.ts"
import { createRegistrationCustomerMessageSourceResolver, readRegistrationCustomerMessagePrivateSource } from "../../src/features/tasks/server/registration-customer-message-source.ts"
import { createRegistrationCustomerMessageRouteHandlers } from "../../src/features/tasks/server/registration-customer-message-route.ts"
import { createRegistrationCustomerMessageClient } from "../../src/features/tasks/registration-customer-message-service.ts"

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const READY = {
  runtimeReady: true, activationMode: "live", activationEligible: true,
  credentialsConfigured: true, pfConfigured: true, templateConfigured: true,
  templateVerified: true, verifiedAt: "2026-10-29T00:00:00.000Z",
  sourceValid: true, sendAllowed: true, blockers: [],
}

// Only the persistence/provider boundaries are synthetic. The catalog, source
// normalizer, route projection, public client parser and mounted UI are real.
// These fixtures exercise the existing SQL contract; they do not execute SQL.
export function createBookingPreviewHarness(messageKind = "level_test_booking") {
  const target = { messageKind, sourceId: id(2) }
  const state = { revision: 8, role: "staff", canceled: false, blocked: false, loseResponse: false, markerDenied: false, outcome: "accepted",
    scheduledAt: null, place: "팁스학원 3층", subjects: ["수학"] }
  const calls = { preview: [], responses: [], send: [], claim: [], marker: 0, provider: 0, delivery: [], source: [] }
  const receipts = new Map()
  const recorded = new Map()
  const oldMessage = {
    messageId: id(5), messageKind, currentStatus: "accepted", confirmedByName: "합성 관리팀",
    confirmedAt: "2026-10-28T00:00:00.000Z", updatedAt: "2026-10-28T00:00:00.000Z",
    recipientLast4: "5678", canCheck: false,
  }
  const history = [oldMessage]
  const catalog = createRegistrationCustomerMessageCatalog({
    SOLAPI_API_KEY: "synthetic", SOLAPI_API_SECRET: "synthetic", SOLAPI_KAKAO_PF_ID: "synthetic-pf",
    SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_TEMPLATE_ID: "synthetic-level",
    SOLAPI_REGISTRATION_VISIT_BOOKING_TEMPLATE_ID: "synthetic-visit",
    REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER: "synthetic-pepper",
  })
  const resolver = createRegistrationCustomerMessageSourceResolver({
    catalog, recipientHashPepper: "synthetic-pepper",
    resolveSource: async (input) => {
      calls.source.push({ kind: input.messageKind, revision: state.revision })
      assert.equal(input.messageKind, messageKind)
      const appointmentKind = messageKind === "level_test_booking" ? "level_test" : "visit_consultation"
      return {
        messageKind, sourceId: input.sourceId, taskId: id(3), trackId: null,
        appointmentId: input.sourceId, sourceRevision: state.revision,
        studentName: "합성 학생", parentPhoneDigits: "01012345678", subjects: [...state.subjects],
        participants: state.subjects.map((subject, index) => ({ trackId: id(4 + index), subject, workflowRevision: state.revision,
          workflowStatus: appointmentKind === "level_test" ? "level_test_requested" : "consultation_requested",
          activityId: id(6 + index), activityStatus: state.canceled ? "canceled" : "scheduled" })),
        appointmentKind, scheduledAt: state.scheduledAt ?? `2099-11-${String(state.revision).padStart(2, "0")}T15:30:00+09:00`,
        place: state.place,
      }
    },
  })
  const publicResult = (message, extra = {}) => ({ ...message, ok: message.currentStatus === "accepted", idempotent: false, ...extra })
  const handlers = createRegistrationCustomerMessageRouteHandlers({
    authenticate: async () => ({ actorProfileId: id(1), role: state.role, actorClient: {} }),
    authorizeTask: async () => true,
    resolveTaskId: async () => id(3),
    resolveSource: (input) => resolver.resolve(input),
    readPrivateSource: readRegistrationCustomerMessagePrivateSource,
    getReadiness: async () => state.blocked || recorded.has(state.revision)
      ? { ...READY, sendAllowed: false, blockers: ["duplicate_locked"] } : READY,
    listHistory: async () => history,
    createPreview: async (input) => {
      const previewId = id(100 + receipts.size)
      receipts.set(previewId, { target: { ...target }, revision: state.revision, contract: input.contract })
      return { previewId, expiresAt: new Date(Date.now() + 900_000).toISOString(), messageKind, recipientLast4: "5678" }
    },
    readPreviewTarget: async ({ previewId }) => ({ ...receipts.get(previewId).target, taskId: id(3) }),
    claimMessage: async (input) => {
      calls.claim.push({ previewId: input.previewId, requestKey: input.requestKey })
      const receipt = receipts.get(input.previewId)
      // A fixed fixture of stale-preview rejection, not a replacement SQL test.
      if (receipt.contract.sourceFingerprint !== input.contract.sourceFingerprint) throw { code: "22023" }
      const existing = recorded.get(receipt.revision)
      if (existing) return publicResult(existing, { owner: false, idempotent: true })
      return publicResult({ ...oldMessage, messageId: id(200 + receipt.revision), currentStatus: "pending" }, {
        owner: true, claimToken: id(7), dispatchToken: id(8),
      })
    },
    markAttemptStarted: async ({ messageId }) => {
      calls.marker += 1
      return state.markerDenied ? { allowed: false, messageId, currentStatus: "accepted" }
        : { allowed: true, messageId, currentStatus: "pending", dispatchToken: id(8) }
    },
    sendProvider: async () => {
      calls.provider += 1
      return { outcome: state.outcome, providerPayloadChecksum: "a".repeat(64), evidence: {
        statusCode: "2000", statusMessage: "synthetic accepted", observedAt: new Date().toISOString(), requestKeyMatched: true,
      } }
    },
    finalizeMessage: async ({ messageId, outcome }) => {
      const message = { ...oldMessage, messageId, currentStatus: outcome, recipientLast4: "5678", confirmedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      recorded.set(state.revision, message)
      history.unshift(message)
      return publicResult(message)
    },
  })
  const client = createRegistrationCustomerMessageClient({
    getAccessToken: async () => "synthetic-session",
    fetch: async (url, init) => {
      if (url.includes("/delivery?")) {
        const messageId = new URL(url, "http://synthetic.invalid").searchParams.get("messageId")
        calls.delivery.push(messageId)
        return Response.json({ ok: true, deliveryStatus: "delivered", checkedAt: new Date().toISOString() })
      }
      const body = JSON.parse(init.body)
      const request = new Request(`http://synthetic.invalid${url}`, init)
      if (url.endsWith("/preview")) {
        calls.preview.push(body)
        const response = await handlers.preview(request)
        calls.responses.push(await response.clone().json())
        return response
      }
      if (url.endsWith("/send")) {
        calls.send.push(body)
        const response = await handlers.send(request)
        if (state.loseResponse) { state.loseResponse = false; throw new TypeError("synthetic response lost") }
        return response
      }
      throw new Error(`unexpected synthetic transport: ${url}`)
    },
  })
  return { target, state, calls, client, history, recorded, receipts, oldMessage, resolver }
}
