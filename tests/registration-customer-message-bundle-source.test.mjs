import assert from "node:assert/strict"
import test from "node:test"

import {
  createRegistrationCustomerMessageBundleSourceResolver,
  parseRegistrationCustomerMessageBundleSource,
} from "../src/features/tasks/server/registration-customer-message-bundle-source.ts"
import { createRegistrationCustomerMessageCatalog } from "../src/features/tasks/server/registration-customer-message-catalog.ts"

const TASK_ID = "96000000-0000-4000-8000-000000000005"
const BUNDLE_ID = "96000000-0000-4000-8000-000000000006"
const SOURCE_ID = "96000000-0000-4000-8000-000000000007"
const TRACK_ID = "96000000-0000-4000-8000-000000000008"

const source = Object.freeze({
  messageKind: "level_test_booking_bundle",
  sourceId: TASK_ID,
  bundleId: BUNDLE_ID,
  bundleRevision: 1,
  taskId: TASK_ID,
  reservationKind: "level_test",
  deliveryKind: "booking",
  serviceDate: null,
  recipientRevision: 1,
  sourceFingerprint: "a".repeat(64),
  studentName: "김팁스",
  parentPhoneDigits: "01012345678",
  items: [{
    sourceKind: "level_test",
    sourceId: SOURCE_ID,
    sourceRevision: { appointmentNotificationRevision: 1 },
    trackId: TRACK_ID,
    activityId: null,
    subject: "영어",
    scheduledAt: "2026-08-21T05:00:00.000Z",
    serviceDate: "2026-08-21",
    place: "본관",
    className: null,
    teacherName: null,
    sourceFactHash: "b".repeat(64),
  }],
})

test("bundle source parser accepts only the private DB shape", () => {
  const parsed = parseRegistrationCustomerMessageBundleSource(source)
  assert.equal(parsed.taskId, TASK_ID)
  assert.equal(parsed.items[0].subject, "영어")
  assert.throws(() => parseRegistrationCustomerMessageBundleSource({ ...source, phone: "01000000000" }))
  assert.throws(() => parseRegistrationCustomerMessageBundleSource({ ...source, items: [] }))
})

test("bundle resolver renders public reservation facts without private delivery fields", async () => {
  const resolver = createRegistrationCustomerMessageBundleSourceResolver({
    catalog: createRegistrationCustomerMessageCatalog({}),
    resolveSource: async () => source,
  })
  const publicSource = await resolver.resolve({ messageKind: "level_test_booking_bundle", sourceId: TASK_ID })
  assert.deepEqual(publicSource.facts.reservations.map((item) => item.subjectLabel), ["영어"])
  assert.doesNotMatch(JSON.stringify(publicSource), /01012345678|000000000006|000000000007|aaaaaaaa/u)
})

test("bundle resolver reuses the existing template with per-subject labels when schedules differ", async () => {
  const resolver = createRegistrationCustomerMessageBundleSourceResolver({
    catalog: createRegistrationCustomerMessageCatalog({}),
    resolveSource: async () => ({
      ...source,
      items: [
        source.items[0],
        {
          ...source.items[0],
          sourceId: "96000000-0000-4000-8000-000000000009",
          trackId: "96000000-0000-4000-8000-000000000010",
          subject: "수학",
          scheduledAt: "2026-08-22T07:50:00.000Z",
          serviceDate: "2026-08-22",
          place: "별관",
          sourceFactHash: "c".repeat(64),
        },
      ],
    }),
  })

  const publicSource = await resolver.resolve({ messageKind: "level_test_booking_bundle", sourceId: TASK_ID })

  assert.match(publicSource.body, /과목: 영어, 수학/u)
  assert.match(publicSource.body, /일시: 2026년 8월 21일 금요일 오후 2:00\(영어\), 2026년 8월 22일 토요일 오후 4:50\(수학\)/u)
  assert.match(publicSource.body, /장소: 본관\(영어\), 별관\(수학\)/u)
})
