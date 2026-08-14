import assert from "node:assert/strict"
import test from "node:test"

import {
  createWiredLightweightRegistrationAlertCoordinator,
} from "../src/features/notifications/server/lightweight-registration-alert-dispatcher.ts"

const SOURCE_IDS = Object.freeze({
  level: "00000000-0000-4000-8000-000000000011",
  visit: "00000000-0000-4000-8000-000000000012",
  observation: "00000000-0000-4000-8000-000000000013",
})
const DIRECTOR = "00000000-0000-4000-8000-000000000021"
const TEACHER = "00000000-0000-4000-8000-000000000022"
const RECEIPT_HASH = "a".repeat(64)

function candidate(sourceKind, sourceId) {
  return {
    sourceKind,
    sourceId,
    sourceRevision: 1,
    eventKind: "booking_confirmed",
    scheduledAt: "2026-08-14T05:00:00.000Z",
    bookingConfirmedAt: "2026-08-13T23:00:00.000Z",
    directorProfileIds: sourceKind === "visit_consultation" ? [DIRECTOR] : [],
    teacherProfileId: sourceKind === "observation_class" ? TEACHER : null,
    subject: sourceKind === "observation_class" ? "영어" : null,
  }
}

function snapshot(intent) {
  const isVisit = intent.sourceKind === "visit_consultation"
  const isObservation = intent.sourceKind === "observation_class"
  return {
    sourceKind: intent.sourceKind,
    sourceId: intent.sourceId,
    sourceRevision: intent.sourceRevision,
    status: "scheduled",
    scheduledAt: intent.scheduledAt,
    studentDisplayName: "김팁스 학생",
    subjectLabels: isObservation ? ["영어"] : ["수학"],
    placeLabel: isObservation ? "별관 201호" : "본관 상담실",
    className: isObservation ? "중2 영어 A" : null,
    teacherName: isObservation ? "이선생" : null,
    directorNames: isVisit ? ["박원장"] : [],
    directorProfileIds: isVisit ? [DIRECTOR] : [],
    teacherProfileId: isObservation ? TEACHER : null,
    subject: isObservation ? "영어" : null,
    verifiedProfileIds: isVisit ? [DIRECTOR] : isObservation ? [TEACHER] : [],
  }
}

function harness({ failCustomerFor = null } = {}) {
  const reserved = new Set()
  const customerCalls = []
  const chatCalls = []
  const receipts = []
  const sourceRecords = new Map(Object.values(SOURCE_IDS).map((id) => [id, { id, saved: true }]))
  const coordinator = createWiredLightweightRegistrationAlertCoordinator({
    async listReminderCandidates() { return [] },
    async reserveIntent(intent) {
      if (reserved.has(intent.dedupeKey)) return false
      reserved.add(intent.dedupeKey)
      return true
    },
    async readSource(intent) { return snapshot(intent) },
    async finalizeReceipt(intent, receipt) { receipts.push({ intent, receipt }) },
    async pruneReceiptsBefore() {},
    customerProvider: {
      async send(input) {
        customerCalls.push(input)
        if (input.intent.sourceKind === failCustomerFor) {
          return { result: "failed_hold", httpStatus: 400, providerReferenceHash: null }
        }
        return { result: "accepted", httpStatus: 202, providerReferenceHash: RECEIPT_HASH }
      },
    },
    googleChatProvider: {
      async send(input) {
        chatCalls.push(input)
        return { result: "accepted", httpStatus: 200, providerReferenceHash: RECEIPT_HASH }
      },
    },
  })
  return { coordinator, customerCalls, chatCalls, receipts, sourceRecords }
}

test("booking dispatcher wires all customer kinds and only the two approved Chat routes", async () => {
  const state = harness()
  await state.coordinator.dispatchBooking(candidate("level_test", SOURCE_IDS.level))
  await state.coordinator.dispatchBooking(candidate("visit_consultation", SOURCE_IDS.visit))
  await state.coordinator.dispatchBooking(candidate("observation_class", SOURCE_IDS.observation))

  assert.deepEqual(state.customerCalls.map(({ messageKind }) => messageKind), [
    "level_test_booking",
    "visit_consultation_booking",
    "observation_booking",
  ])
  assert.deepEqual(state.chatCalls.map(({ connectionKey, mentionProfileIds }) => ({
    connectionKey,
    mentionProfileIds,
  })), [
    { connectionKey: "google_chat.management", mentionProfileIds: [DIRECTOR] },
    { connectionKey: "google_chat.english", mentionProfileIds: [TEACHER] },
  ])
  assert.match(state.chatCalls[0].text, /방문상담 예약 완료[\s\S]*김팁스 학생[\s\S]*수학[\s\S]*본관 상담실[\s\S]*박원장/u)
  assert.match(state.chatCalls[1].text, /청강 예약 완료[\s\S]*김팁스 학생[\s\S]*중2 영어 A[\s\S]*별관 201호[\s\S]*이선생/u)
})

test("same booking replay makes zero provider calls and keeps external receipts separate from source records", async () => {
  const state = harness()
  const input = candidate("visit_consultation", SOURCE_IDS.visit)
  await state.coordinator.dispatchBooking(input)
  await state.coordinator.dispatchBooking(input)

  assert.equal(state.customerCalls.length, 1)
  assert.equal(state.chatCalls.length, 1)
  assert.equal(state.receipts.length, 2)
  assert.deepEqual([...state.sourceRecords.values()], [{ id: SOURCE_IDS.level, saved: true }, { id: SOURCE_IDS.visit, saved: true }, { id: SOURCE_IDS.observation, saved: true }])
  assert.equal(state.receipts.every(({ receipt }) => receipt.providerReferenceHash === RECEIPT_HASH), true)
})

test("customer failure is finalized independently and never suppresses visit Chat", async () => {
  const state = harness({ failCustomerFor: "visit_consultation" })
  await state.coordinator.dispatchBooking(candidate("visit_consultation", SOURCE_IDS.visit))

  assert.equal(state.customerCalls.length, 1)
  assert.equal(state.chatCalls.length, 1)
  assert.deepEqual(state.receipts.map(({ receipt }) => receipt.result), ["failed_hold", "accepted"])
  assert.equal(state.sourceRecords.get(SOURCE_IDS.visit).saved, true)
})
