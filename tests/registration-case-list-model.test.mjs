import assert from "node:assert/strict"
import test from "node:test"

import {
  buildRegistrationCaseListItems,
  filterRegistrationCaseListItems,
  getRegistrationCaseMatchedTracks,
  getRegistrationCaseTabCounts,
  getRegistrationCaseTrackTimeValue,
} from "../src/features/tasks/registration-case-list-model.ts"

function track({
  id,
  subject = "영어",
  status = "inquiry",
  directorName = "",
  directorProfileId = null,
  stageEnteredAt = "2026-07-12T00:00:00Z",
  phoneReadyAt = null,
  visitScheduledAt = "",
  visitPlace = "",
} = {}) {
  return {
    id,
    taskId: "",
    subject,
    status,
    directorName,
    directorProfileId,
    stageEnteredAt,
    phoneReadyAt,
    visitScheduledAt,
    visitPlace,
    migrationReviewRequired: false,
  }
}

function registrationCase({
  id,
  studentName = id,
  title = "",
  registration = {},
  registrationTracks = [],
} = {}) {
  return {
    id,
    title,
    studentName,
    registration: {
      parentPhone: "",
      studentPhone: "",
      schoolGrade: "",
      schoolName: "",
      requestNote: "",
      ...registration,
    },
    registrationTracks: registrationTracks.map((item) => ({ ...item, taskId: id })),
  }
}

test("one parent task projects to one case item while retaining every subject track", () => {
  const items = buildRegistrationCaseListItems([
    registrationCase({
      id: "case-1",
      studentName: "민지",
      registrationTracks: [
        track({ id: "eng", subject: "영어", status: "inquiry" }),
        track({ id: "math", subject: "수학", status: "level_test_scheduled" }),
      ],
    }),
  ])

  assert.equal(items.length, 1)
  assert.equal(items[0].key, "case-1")
  assert.deepEqual(items[0].tracks.map((item) => [item.trackId, item.subject, item.sourceIndex]), [
    ["eng", "영어", 0],
    ["math", "수학", 1],
  ])
})

test("one open case appears once in each of its non-completed views", () => {
  const items = buildRegistrationCaseListItems([
    registrationCase({
      id: "case-1",
      registrationTracks: [
        track({ id: "eng", status: "inquiry" }),
        track({ id: "math", subject: "수학", status: "waiting" }),
      ],
    }),
  ])

  assert.equal(filterRegistrationCaseListItems(items, "inquiry").length, 1)
  assert.equal(filterRegistrationCaseListItems(items, "waiting").length, 1)
  assert.equal(filterRegistrationCaseListItems(items, "closed").length, 0)
})

test("same-view subject tracks remain in one case row and counts increment once", () => {
  const items = buildRegistrationCaseListItems([
    registrationCase({
      id: "case-1",
      registrationTracks: [
        track({ id: "eng", status: "consultation_waiting" }),
        track({ id: "math", subject: "수학", status: "visit_consultation_scheduled" }),
      ],
    }),
    registrationCase({
      id: "case-2",
      registrationTracks: [track({ id: "case-2-eng", status: "consultation_waiting" })],
    }),
  ])

  assert.deepEqual(getRegistrationCaseMatchedTracks(items[0], "consulting").map((item) => item.trackId), ["eng", "math"])
  assert.equal(filterRegistrationCaseListItems(items, "consulting").length, 2)
  assert.deepEqual(getRegistrationCaseTabCounts(items), {
    inquiry: 0,
    level_test: 0,
    consulting: 2,
    waiting: 0,
    enrollment: 0,
    closed: 0,
  })
})

test("closed view requires tracks and only admits cases whose tracks are all terminal", () => {
  const items = buildRegistrationCaseListItems([
    registrationCase({ id: "empty" }),
    registrationCase({ id: "mixed", registrationTracks: [
      track({ id: "mixed-eng", status: "registered" }),
      track({ id: "mixed-math", subject: "수학", status: "waiting" }),
    ] }),
    registrationCase({ id: "closed", registrationTracks: [
      track({ id: "closed-eng", status: "registered" }),
      track({ id: "closed-math", subject: "수학", status: "not_registered" }),
    ] }),
  ])

  assert.deepEqual(filterRegistrationCaseListItems(items, "closed").map((item) => item.taskId), ["closed"])
  assert.equal(getRegistrationCaseTabCounts(items).closed, 1)
})

test("consultation puts phone work before visits and sorts valid readiness times first", () => {
  const source = [
    registrationCase({ id: "visit", registrationTracks: [track({ id: "visit-track", status: "visit_consultation_scheduled", visitScheduledAt: "2026-07-30T10:00:00Z" })] }),
    registrationCase({ id: "late", registrationTracks: [track({ id: "late-track", status: "consultation_waiting", phoneReadyAt: "2026-07-12T10:00:00Z" })] }),
    registrationCase({ id: "early", registrationTracks: [track({ id: "early-track", status: "consultation_waiting", phoneReadyAt: "2026-07-12T09:00:00Z" })] }),
    registrationCase({ id: "invalid", registrationTracks: [track({ id: "invalid-track", status: "consultation_waiting", phoneReadyAt: "not-a-date" })] }),
    registrationCase({ id: "missing", registrationTracks: [track({ id: "missing-track", status: "consultation_waiting" })] }),
  ]
  const items = buildRegistrationCaseListItems(source)

  const result = filterRegistrationCaseListItems(items, "consulting")
  assert.deepEqual(result.map((item) => item.taskId), ["early", "late", "invalid", "missing", "visit"])
  assert.equal(result[0].representativeTrack.trackId, "early-track")
  assert.equal(result[0].representativeSortValue, "2026-07-12T09:00:00Z")
  assert.deepEqual(source.map((item) => item.id), ["visit", "late", "early", "invalid", "missing"])
})

test("the representative is the first sorted matching track while matching tracks keep source order", () => {
  const items = buildRegistrationCaseListItems([
    registrationCase({
      id: "case-1",
      registrationTracks: [
        track({ id: "visit", status: "visit_consultation_scheduled", visitScheduledAt: "2026-07-16T10:00:00Z" }),
        track({ id: "phone", subject: "수학", status: "consultation_waiting", phoneReadyAt: "2026-07-15T10:00:00Z" }),
      ],
    }),
  ])

  const [result] = filterRegistrationCaseListItems(items, "consulting")
  assert.deepEqual(result.matchingTracks.map((item) => item.trackId), ["visit", "phone"])
  assert.equal(result.representativeTrack.trackId, "phone")
})

test("consultation sort ties use task IDs and do not mutate input", () => {
  const tasks = [
    registrationCase({ id: "case-b", registrationTracks: [track({ id: "b", status: "consultation_waiting", phoneReadyAt: "2026-07-12T09:00:00Z" })] }),
    registrationCase({ id: "case-a", registrationTracks: [
      track({ id: "a-inquiry", status: "inquiry" }),
      track({ id: "a", status: "consultation_waiting", phoneReadyAt: "2026-07-12T09:00:00Z" }),
    ] }),
  ]
  const items = buildRegistrationCaseListItems(tasks)

  assert.deepEqual(filterRegistrationCaseListItems(items, "consulting").map((item) => item.taskId), ["case-a", "case-b"])
  assert.deepEqual(items.map((item) => item.taskId), ["case-b", "case-a"])
})

test("search spans common identity and all subject labels but limits director and place to the selected view", () => {
  const items = buildRegistrationCaseListItems([
    registrationCase({
      id: "case-1",
      studentName: "김민지",
      registration: { parentPhone: "010-1234-5678", studentPhone: "010 9876 5432" },
      registrationTracks: [
        track({ id: "eng", subject: "영어", status: "inquiry", directorName: "문의 책임자", visitPlace: "문의실" }),
        track({ id: "math", subject: "수학", status: "consultation_waiting", directorName: "상담 책임자", visitPlace: "상담실" }),
      ],
    }),
  ])

  assert.equal(filterRegistrationCaseListItems(items, "inquiry", "김민지").length, 1)
  assert.equal(filterRegistrationCaseListItems(items, "inquiry", "01012345678").length, 1)
  assert.equal(filterRegistrationCaseListItems(items, "inquiry", "수학").length, 1)
  assert.equal(filterRegistrationCaseListItems(items, "consulting", "상담 책임자").length, 1)
  assert.equal(filterRegistrationCaseListItems(items, "inquiry", "상담 책임자").length, 0)
  assert.equal(filterRegistrationCaseListItems(items, "inquiry", "상담실").length, 0)
})

test("case track time values retain the status-specific date source", () => {
  assert.equal(getRegistrationCaseTrackTimeValue({ status: "consultation_waiting", stageEnteredAt: "stage", phoneReadyAt: "phone", visitScheduledAt: "visit" }), "phone")
  assert.equal(getRegistrationCaseTrackTimeValue({ status: "visit_consultation_scheduled", stageEnteredAt: "stage", phoneReadyAt: null, visitScheduledAt: "visit" }), "visit")
  assert.equal(getRegistrationCaseTrackTimeValue({ status: "waiting", stageEnteredAt: "stage", phoneReadyAt: null, visitScheduledAt: "visit" }), "stage")
})
