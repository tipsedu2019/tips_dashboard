import assert from "node:assert/strict"
import test from "node:test"

import {
  LIGHTWEIGHT_REGISTRATION_ALERT_CRON,
  buildLightweightRegistrationAlertIntents,
  createLightweightRegistrationAlertCoordinator,
  getLightweightReminderRunWindow,
  resolveLightweightRegistrationChatTarget,
} from "../src/features/notifications/server/lightweight-registration-alerts.ts"

const IDS = Object.freeze({
  source: "00000000-0000-4000-8000-000000000001",
  directorA: "00000000-0000-4000-8000-000000000002",
  directorB: "00000000-0000-4000-8000-000000000003",
  teacher: "00000000-0000-4000-8000-000000000004",
})

function booking(overrides = {}) {
  return {
    sourceKind: "visit_consultation",
    sourceId: IDS.source,
    sourceRevision: 3,
    eventKind: "booking_confirmed",
    scheduledAt: "2026-08-14T05:00:00.000Z",
    bookingConfirmedAt: "2026-08-13T23:30:00.000Z",
    directorProfileIds: [IDS.directorB, IDS.directorA, IDS.directorA],
    teacherProfileId: null,
    subject: null,
    ...overrides,
  }
}

test("external matrix gives every registration type one customer delivery and excludes level-test Chat", () => {
  assert.deepEqual(
    buildLightweightRegistrationAlertIntents(booking({ sourceKind: "level_test" }))
      .map(({ channel }) => channel),
    ["customer_alimtalk"],
  )
  assert.deepEqual(
    buildLightweightRegistrationAlertIntents(booking())
      .map(({ channel }) => channel),
    ["customer_alimtalk", "google_chat"],
  )
  assert.deepEqual(
    buildLightweightRegistrationAlertIntents(booking({
      sourceKind: "observation_class",
      directorProfileIds: [],
      teacherProfileId: IDS.teacher,
      subject: "수학",
    })).map(({ channel }) => channel),
    ["customer_alimtalk", "google_chat"],
  )
})

test("intents are external-only and use stable booking/day keys for channel-local idempotency", () => {
  const bookingIntents = buildLightweightRegistrationAlertIntents(booking())
  assert.deepEqual(bookingIntents.map(({ dedupeKey }) => dedupeKey), [
    `visit_consultation:${IDS.source}:booking_confirmed:customer_alimtalk:booking`,
    `visit_consultation:${IDS.source}:booking_confirmed:google_chat:booking`,
  ])
  assert.equal(bookingIntents.some(({ channel }) => channel === "in_app"), false)

  const reminderIntents = buildLightweightRegistrationAlertIntents(booking({
    eventKind: "same_day_reminder",
    reminderLocalDate: "2026-08-14",
  }))
  assert.deepEqual(reminderIntents.map(({ dedupeKey }) => dedupeKey), [
    `visit_consultation:${IDS.source}:same_day_reminder:customer_alimtalk:2026-08-14`,
    `visit_consultation:${IDS.source}:same_day_reminder:google_chat:2026-08-14`,
  ])
})

test("visit Chat uses management room and all-or-none distinct responsible-director mentions", () => {
  assert.deepEqual(resolveLightweightRegistrationChatTarget({
    sourceKind: "visit_consultation",
    subject: null,
    directorProfileIds: [IDS.directorB, IDS.directorA, IDS.directorA],
    teacherProfileId: null,
    verifiedProfileIds: [IDS.directorA, IDS.directorB],
  }), {
    connectionKey: "google_chat.management",
    mentionProfileIds: [IDS.directorA, IDS.directorB],
    mentionResolution: "resolved",
  })

  assert.deepEqual(resolveLightweightRegistrationChatTarget({
    sourceKind: "visit_consultation",
    subject: null,
    directorProfileIds: [IDS.directorA, IDS.directorB],
    teacherProfileId: null,
    verifiedProfileIds: [IDS.directorA],
  }), {
    connectionKey: "google_chat.management",
    mentionProfileIds: [],
    mentionResolution: "mention_unresolved",
  })
})

test("observation Chat uses only the booked subject room and exact booked teacher", () => {
  assert.deepEqual(resolveLightweightRegistrationChatTarget({
    sourceKind: "observation_class",
    subject: "과학",
    directorProfileIds: [IDS.directorA],
    teacherProfileId: IDS.teacher,
    verifiedProfileIds: [IDS.teacher, IDS.directorA],
  }), {
    connectionKey: "google_chat.science",
    mentionProfileIds: [IDS.teacher],
    mentionResolution: "resolved",
  })
  assert.throws(() => resolveLightweightRegistrationChatTarget({
    sourceKind: "level_test",
    subject: null,
    directorProfileIds: [],
    teacherProfileId: null,
    verifiedProfileIds: [],
  }), /lightweight_registration_chat_not_allowed/u)
})

test("daily reminder window is exactly 10:00 KST with one daily cron and a fixed cutoff", () => {
  assert.equal(LIGHTWEIGHT_REGISTRATION_ALERT_CRON, "0 1 * * *")
  assert.equal(getLightweightReminderRunWindow(new Date("2026-08-14T00:59:59.999Z")), null)
  assert.deepEqual(getLightweightReminderRunWindow(new Date("2026-08-14T01:15:00.000Z")), {
    localDate: "2026-08-14",
    cutoffAt: "2026-08-14T01:00:00.000Z",
    receiptRetentionBefore: "2026-08-07T01:15:00.000Z",
  })
})

test("daily run excludes post-10:00 same-day bookings and dispatches each source/channel once", async () => {
  const reserved = new Set()
  const dispatched = []
  const prunes = []
  const candidates = [
    booking({ sourceId: "00000000-0000-4000-8000-000000000011" }),
    booking({
      sourceId: "00000000-0000-4000-8000-000000000012",
      bookingConfirmedAt: "2026-08-14T01:05:00.000Z",
    }),
  ]
  const coordinator = createLightweightRegistrationAlertCoordinator({
    async listReminderCandidates() { return candidates },
    async reserveIntent(intent) {
      if (reserved.has(intent.dedupeKey)) return false
      reserved.add(intent.dedupeKey)
      return true
    },
    async dispatchIntent(intent) { dispatched.push(intent.dedupeKey) },
    async pruneReceiptsBefore(value) { prunes.push(value) },
  })

  const first = await coordinator.runDaily(new Date("2026-08-14T01:15:00.000Z"))
  const replay = await coordinator.runDaily(new Date("2026-08-14T01:30:00.000Z"))

  assert.deepEqual(first, { status: "completed", candidates: 1, dispatched: 2, failed: 0 })
  assert.deepEqual(replay, { status: "completed", candidates: 1, dispatched: 0, failed: 0 })
  assert.deepEqual(dispatched, [
    "visit_consultation:00000000-0000-4000-8000-000000000011:same_day_reminder:customer_alimtalk:2026-08-14",
    "visit_consultation:00000000-0000-4000-8000-000000000011:same_day_reminder:google_chat:2026-08-14",
  ])
  assert.deepEqual(prunes, ["2026-08-07T01:15:00.000Z", "2026-08-07T01:30:00.000Z"])
})

test("one channel failure cannot roll back or duplicate the other channel", async () => {
  const reserved = new Set()
  const attempts = []
  const coordinator = createLightweightRegistrationAlertCoordinator({
    async listReminderCandidates() { return [] },
    async reserveIntent(intent) {
      if (reserved.has(intent.dedupeKey)) return false
      reserved.add(intent.dedupeKey)
      return true
    },
    async dispatchIntent(intent) {
      attempts.push(intent.channel)
      if (intent.channel === "customer_alimtalk") throw new Error("provider unavailable")
    },
    async pruneReceiptsBefore() {},
  })

  const first = await coordinator.dispatchBooking(booking())
  const replay = await coordinator.dispatchBooking(booking())

  assert.deepEqual(first, { dispatched: 1, failed: 1 })
  assert.deepEqual(replay, { dispatched: 0, failed: 0 })
  assert.deepEqual(attempts, ["customer_alimtalk", "google_chat"])
})
