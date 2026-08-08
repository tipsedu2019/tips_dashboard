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
  workflowStatus,
  directorName = "",
  directorProfileId = null,
  stageEnteredAt = "2026-07-12T00:00:00Z",
  phoneReadyAt = null,
  levelTestScheduledAt = "",
  levelTestPlace = "",
  visitScheduledAt = "",
  visitPlace = "",
} = {}) {
  return {
    id,
    taskId: "",
    subject,
    status,
    workflowStatus,
    directorName,
    directorProfileId,
    stageEnteredAt,
    phoneReadyAt,
    levelTestScheduledAt,
    levelTestPlace,
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

test("level-test rows use active canonical appointments and collapse a shared reservation", async () => {
  const { getRegistrationCaseLevelTestAppointments } = await import(
    "../src/features/tasks/registration-case-list-model.ts"
  )
  assert.equal(typeof getRegistrationCaseLevelTestAppointments, "function")
  const items = buildRegistrationCaseListItems([
    registrationCase({
      id: "case-1",
      registration: {
        levelTestAt: "",
        levelTestPlace: "",
      },
      registrationTracks: [
        track({
          id: "eng",
          subject: "영어",
          workflowStatus: "level_test_requested",
          levelTestScheduledAt: "2026-08-10T06:00:00Z",
          levelTestPlace: "본관",
        }),
        track({
          id: "math",
          subject: "수학",
          workflowStatus: "level_test_requested",
          levelTestScheduledAt: "2026-08-10T06:00:00Z",
          levelTestPlace: "본관",
        }),
        track({
          id: "science",
          subject: "과학",
          workflowStatus: "level_test_requested",
          levelTestScheduledAt: "2026-08-11T09:00:00Z",
          levelTestPlace: "별관",
        }),
      ],
    }),
  ])
  const [levelTestCase] = filterRegistrationCaseListItems(items, "level_test")

  assert.deepEqual(
    getRegistrationCaseLevelTestAppointments(levelTestCase.matchingTracks),
    [
      {
        scheduledAt: "2026-08-10T06:00:00Z",
        place: "본관",
        subjects: ["영어", "수학"],
      },
      {
        scheduledAt: "2026-08-11T09:00:00Z",
        place: "별관",
        subjects: ["과학"],
      },
    ],
  )
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
    consultation_requested: 2,
    consultation_completed: 0,
    waiting: 0,
    enrollment: 0,
    payment: 0,
    completed: 0,
  })
})

test("mine consultation scope keeps only viewer-owned subjects in one case row", () => {
  const items = buildRegistrationCaseListItems([
    registrationCase({
      id: "case-1",
      registrationTracks: [
        track({
          id: "eng",
          subject: "영어",
          status: "visit_consultation_scheduled",
          directorProfileId: "director-me",
          directorName: "내 책임자",
          visitScheduledAt: "2026-08-03T10:00:00+09:00",
        }),
        track({
          id: "math",
          subject: "수학",
          status: "consultation_waiting",
          directorProfileId: "director-other",
          directorName: "다른 책임자",
          phoneReadyAt: "2026-08-02T09:00:00+09:00",
        }),
      ],
    }),
  ])

  const [mine] = filterRegistrationCaseListItems(items, "consultation_requested", "", {
    consultationOwnerId: "director-me",
  })

  assert.deepEqual(mine.matchingTracks.map((item) => item.trackId), ["eng"])
  assert.equal(mine.representativeTrack.trackId, "eng")
  assert.equal(mine.representativeSortValue, "2026-08-03T10:00:00+09:00")
  assert.deepEqual(
    filterRegistrationCaseListItems(items, "consultation_requested")[0].matchingTracks.map((item) => item.trackId),
    ["math", "eng"],
  )
})

test("mine consultation scope also filters completed subjects", () => {
  const items = buildRegistrationCaseListItems([
    registrationCase({
      id: "case-1",
      registrationTracks: [
        track({ id: "eng", workflowStatus: "consultation_completed", directorProfileId: "director-me" }),
        track({ id: "math", subject: "수학", workflowStatus: "consultation_completed", directorProfileId: "director-other" }),
      ],
    }),
  ])

  const [mine] = filterRegistrationCaseListItems(items, "consultation_completed", "", {
    consultationOwnerId: "director-me",
  })

  assert.deepEqual(mine.matchingTracks.map((item) => item.trackId), ["eng"])
  assert.equal(mine.representativeTrack.trackId, "eng")
})

test("mine consultation search excludes other-owner subject and consultation metadata", () => {
  const items = buildRegistrationCaseListItems([
    registrationCase({
      id: "case-1",
      registrationTracks: [
        track({ id: "eng", workflowStatus: "consultation_completed", directorProfileId: "director-me", directorName: "내 책임자" }),
        track({
          id: "math",
          subject: "수학",
          workflowStatus: "consultation_completed",
          directorProfileId: "director-other",
          directorName: "검색되면 안 됨",
          visitPlace: "다른 상담실",
        }),
      ],
    }),
  ])
  const options = { consultationOwnerId: "director-me" }

  assert.equal(filterRegistrationCaseListItems(items, "consultation_completed", "수학", options).length, 0)
  assert.equal(filterRegistrationCaseListItems(items, "consultation_completed", "검색되면 안 됨", options).length, 0)
  assert.equal(filterRegistrationCaseListItems(items, "consultation_completed", "다른 상담실", options).length, 0)
  assert.equal(filterRegistrationCaseListItems(items, "consultation_completed", "내 책임자", options).length, 1)
})

test("mine consultation scope is empty when the viewer ID is unavailable", () => {
  const items = buildRegistrationCaseListItems([
    registrationCase({
      id: "case-1",
      registrationTracks: [
        track({ id: "eng", status: "consultation_waiting", directorProfileId: "director-me" }),
      ],
    }),
  ])

  assert.equal(filterRegistrationCaseListItems(items, "consultation_requested", "", { consultationOwnerId: "" }).length, 0)
  assert.equal(filterRegistrationCaseListItems(items, "consultation_requested", "", { consultationOwnerId: null }).length, 0)
})

test("completed view projects completed subjects even when another subject remains active", () => {
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

  assert.deepEqual(filterRegistrationCaseListItems(items, "completed").map((item) => item.taskId), ["mixed", "closed"])
  assert.equal(getRegistrationCaseTabCounts(items).completed, 2)
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

test("consultation matching tracks use phone-first display order without mutating source items", () => {
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
  assert.deepEqual(result.matchingTracks.map((item) => item.trackId), ["phone", "visit"])
  assert.equal(result.representativeTrack.trackId, "phone")
  assert.deepEqual(items[0].tracks.map((item) => item.trackId), ["visit", "phone"])
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

test("case track time values prefer active canonical consultation dates without a stage fallback", () => {
  assert.equal(getRegistrationCaseTrackTimeValue({ status: "consultation_waiting", stageEnteredAt: "stage", phoneReadyAt: "phone", visitScheduledAt: "visit" }), "phone")
  assert.equal(getRegistrationCaseTrackTimeValue({ status: "visit_consultation_scheduled", stageEnteredAt: "stage", phoneReadyAt: null, visitScheduledAt: "visit" }), "visit")
  assert.equal(getRegistrationCaseTrackTimeValue({ status: "waiting", stageEnteredAt: "stage", phoneReadyAt: null, visitScheduledAt: "visit" }), "visit")
  assert.equal(getRegistrationCaseTrackTimeValue({ status: "waiting", stageEnteredAt: "stage", phoneReadyAt: null, visitScheduledAt: "" }), "")
})
