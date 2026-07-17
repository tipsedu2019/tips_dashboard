import assert from "node:assert/strict"
import test from "node:test"

import {
  buildRegistrationAppointmentConfirmation,
  compareRegistrationAppointmentDraft,
  isRegistrationNotificationProcessingReady,
  rebaseRegistrationAppointmentDraft,
} from "../src/features/tasks/registration-appointment-draft.ts"

function appointment(overrides = {}) {
  return {
    id: "appointment-1",
    taskId: "task-1",
    kind: "level_test",
    scheduledAt: "2026-07-20T06:00:00.000Z",
    place: "본관 201호",
    status: "scheduled",
    notificationRevision: 4,
    createdAt: "2026-07-17T01:00:00.000Z",
    updatedAt: "2026-07-17T02:00:00.000Z",
    ...overrides,
  }
}

test("충돌 비교는 로컬 초안을 보존하고 최신 서버 값과 필드별 차이를 구분한다", () => {
  const local = Object.freeze({
    scheduledAt: "2026-07-21T07:30:00.000Z",
    place: "신관 상담실",
    trackIds: Object.freeze(["track-math", "track-english"]),
    replaceRemaining: false,
  })
  const server = Object.freeze(appointment())
  const conflict = Object.freeze({
    local,
    server,
    serverTrackIds: Object.freeze(["track-english"]),
  })

  const comparison = compareRegistrationAppointmentDraft(conflict)

  assert.deepEqual(comparison.local, {
    scheduledAt: "2026-07-21T07:30:00.000Z",
    place: "신관 상담실",
    trackIds: ["track-english", "track-math"],
    replaceRemaining: false,
  })
  assert.deepEqual(comparison.server, {
    scheduledAt: "2026-07-20T06:00:00.000Z",
    place: "본관 201호",
    trackIds: ["track-english"],
    replaceRemaining: false,
  })
  assert.equal(comparison.fields.scheduledAt.changed, true)
  assert.equal(comparison.fields.place.changed, true)
  assert.equal(comparison.fields.trackIds.changed, true)
  assert.equal(comparison.hasDifferences, true)
  assert.equal(local.place, "신관 상담실")
  assert.deepEqual(local.trackIds, ["track-math", "track-english"])
})

test("로컬 초안은 명시적으로 다시 적용할 때만 최신 revision 위에 재기반된다", () => {
  const conflict = {
    local: {
      scheduledAt: "2026-07-21T07:30:00.000Z",
      place: "신관 상담실",
      trackIds: ["track-math", "track-english"],
      replaceRemaining: true,
    },
    server: appointment({ notificationRevision: 8 }),
    serverTrackIds: ["track-english"],
  }
  const untouched = structuredClone(conflict)

  assert.deepEqual(conflict, untouched, "비교만으로 로컬 초안이나 기준 revision이 바뀌면 안 된다")

  const rebased = rebaseRegistrationAppointmentDraft(conflict)
  assert.deepEqual(rebased, {
    appointmentId: "appointment-1",
    expectedNotificationRevision: 8,
    draft: {
      scheduledAt: "2026-07-21T07:30:00.000Z",
      place: "신관 상담실",
      trackIds: ["track-english", "track-math"],
      replaceRemaining: true,
    },
  })
  assert.deepEqual(conflict, untouched, "다시 적용도 입력 객체를 변경하면 안 된다")
})

test("저장 확인은 이전·이후 예약과 미래 알림 라운드 수를 함께 보여 준다", () => {
  const message = buildRegistrationAppointmentConfirmation({
    action: "save",
    previous: {
      scheduledAt: "2026-07-20T06:00:00.000Z",
      place: "본관 201호",
      trackIds: ["track-english"],
      replaceRemaining: false,
    },
    next: {
      scheduledAt: "2026-07-21T07:30:00.000Z",
      place: "신관 상담실",
      trackIds: ["track-english", "track-math"],
      replaceRemaining: false,
    },
    previousReminderRoundCount: 2,
    nextReminderRoundCount: 3,
    trackLabels: {
      "track-english": "영어",
      "track-math": "수학",
    },
  })

  assert.match(message, /예약 변경 내용을 확인해 주세요/)
  assert.match(message, /이전.*본관 201호.*영어/s)
  assert.match(message, /이후.*신관 상담실.*영어, 수학/s)
  assert.match(message, /미래 알림.*2회.*3회/s)
})

test("취소 확인은 이후 상태와 0개 라운드를 보여 주며 사유를 요구하지 않는다", () => {
  const message = buildRegistrationAppointmentConfirmation({
    action: "cancel",
    previous: {
      scheduledAt: "2026-07-20T06:00:00.000Z",
      place: "본관 201호",
      trackIds: ["track-english"],
      replaceRemaining: false,
    },
    next: null,
    previousReminderRoundCount: 2,
    nextReminderRoundCount: 0,
    trackLabels: { "track-english": "영어" },
  })

  assert.match(message, /예약 취소 내용을 확인해 주세요/)
  assert.match(message, /이후.*예약 취소/s)
  assert.match(message, /미래 알림.*2회.*0회/s)
  assert.doesNotMatch(message, /사유/)
})

test("처리 상태 안전 게이트는 두 runtime marker와 최근 성공 worker·watchdog가 모두 있어야 열린다", () => {
  const now = Date.parse("2026-07-17T03:00:00.000Z")
  const ready = {
    registrationRuntimeMarker: "registration_appointment_reminders_runtime_version",
    registrationRuntimeVersion: 1,
    adaptersRuntimeMarker: "notification_workflow_adapters_runtime_version",
    adaptersRuntimeVersion: 1,
    workerHeartbeat: { kind: "worker", phase: "succeeded", createdAt: "2026-07-17T02:58:30.000Z" },
    watchdogHeartbeat: { kind: "watchdog", phase: "succeeded", createdAt: "2026-07-17T02:59:00.000Z" },
  }

  assert.equal(isRegistrationNotificationProcessingReady(ready, now), true)
  assert.equal(isRegistrationNotificationProcessingReady(null, now), false)
  assert.equal(isRegistrationNotificationProcessingReady({ ...ready, adaptersRuntimeMarker: "wrong_marker" }, now), false)
  assert.equal(isRegistrationNotificationProcessingReady({ ...ready, adaptersRuntimeVersion: 0 }, now), false)
  assert.equal(isRegistrationNotificationProcessingReady({
    ...ready,
    workerHeartbeat: { kind: "worker", phase: "succeeded", createdAt: "2026-07-17T02:56:59.000Z" },
  }, now), false)
  assert.equal(isRegistrationNotificationProcessingReady({
    ...ready,
    watchdogHeartbeat: { kind: "watchdog", phase: "failed", createdAt: "2026-07-17T02:59:30.000Z" },
  }, now), false)
})
