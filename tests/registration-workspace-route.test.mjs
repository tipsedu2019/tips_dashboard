import assert from "node:assert/strict"
import test from "node:test"

import * as registrationWorkspaceRoute from "../src/features/tasks/registration-workspace-route.ts"

import {
  buildRegistrationWorkspaceSearchParams,
  getRegistrationDirectDeepLinkTarget as getRegistrationDirectDeepLinkTargetRaw,
  isRegistrationConsultationViewKey,
  normalizeRegistrationConsultationOwnerScope,
  normalizeRegistrationWorkspaceCalendarKind,
} from "../src/features/tasks/registration-workspace-route.ts"

function getRegistrationDirectDeepLinkTarget(input) {
  if (input.searchParams) return getRegistrationDirectDeepLinkTargetRaw(input)
  const searchParams = new URLSearchParams()
  if (input.taskId) searchParams.set("taskId", input.taskId)
  if (input.trackId) searchParams.set("trackId", input.trackId)
  if (input.appointmentId) searchParams.set("appointmentId", input.appointmentId)
  const {
    taskId: _taskId,
    trackId: _trackId,
    appointmentId: _appointmentId,
    ...state
  } = input
  return getRegistrationDirectDeepLinkTargetRaw({
    ...state,
    searchParams,
    observationRuntimeVersion: 1,
  })
}

test("route values normalize to safe defaults", () => {
  assert.equal(normalizeRegistrationConsultationOwnerScope(null), "mine")
  assert.equal(normalizeRegistrationConsultationOwnerScope("all"), "all")
  assert.equal(normalizeRegistrationConsultationOwnerScope("someone"), "mine")
  assert.equal(normalizeRegistrationWorkspaceCalendarKind(null), "all")
  assert.equal(normalizeRegistrationWorkspaceCalendarKind("level_test"), "level_test")
  assert.equal(normalizeRegistrationWorkspaceCalendarKind("visit_consultation"), "visit_consultation")
  assert.equal(normalizeRegistrationWorkspaceCalendarKind("phone"), "all")
  assert.equal(isRegistrationConsultationViewKey("consultation_requested"), true)
  assert.equal(isRegistrationConsultationViewKey("waiting"), false)
})

test("observation calendar consumer accepts only one exact five-key UUID tuple", () => {
  // Production break caught: scalar parsing loses duplicate-key evidence or an
  // observation URL falls back to an appointment after malformed input.
  const taskId = "10000000-0000-4000-8000-000000000001"
  const trackId = "10000000-0000-4000-8000-000000000002"
  const appointmentId = "10000000-0000-4000-8000-000000000003"
  const observationId = "10000000-0000-4000-8000-000000000004"
  const orderedTuple = [
    ["taskId", taskId],
    ["trackId", trackId],
    ["appointmentId", appointmentId],
    ["observationId", observationId],
    ["view", "calendar"],
  ]
  const exactTarget = {
    kind: "observation",
    taskId,
    trackId,
    appointmentId,
    observationId,
    view: "calendar",
  }
  const targetFor = (entries, observationRuntimeVersion = 1) => getRegistrationDirectDeepLinkTarget({
    viewerId: "viewer-1",
    searchParams: new URLSearchParams(entries),
    observationRuntimeVersion,
    workspaceReady: false,
    currentSelectionKey: "",
  })

  assert.deepEqual(targetFor(orderedTuple), exactTarget)
  assert.deepEqual(targetFor([...orderedTuple].reverse()), exactTarget)

  for (const [key, value] of orderedTuple) {
    const missingTarget = targetFor(orderedTuple.filter(([candidate]) => candidate !== key))
    if (key === "observationId") {
      assert.deepEqual(missingTarget, {
        kind: "appointment",
        taskId,
        trackId,
        appointmentId,
      })
    } else {
      assert.equal(missingTarget, null)
    }
    assert.equal(targetFor([...orderedTuple, [key, value]]), null)
    assert.equal(targetFor(orderedTuple.map(([candidate, candidateValue]) => (
      candidate === key ? [candidate, ""] : [candidate, candidateValue]
    ))), null)
  }
  assert.equal(targetFor([...orderedTuple, ["extra", "1"]]), null)
  assert.equal(targetFor(orderedTuple.map(([key, value]) => (
    key === "appointmentId" ? ["appointmentID", value] : [key, value]
  ))), null)
  for (const idKey of ["taskId", "trackId", "appointmentId", "observationId"]) {
    assert.equal(targetFor(orderedTuple.map(([key, value]) => (
      key === idKey ? [key, "not-a-uuid"] : [key, value]
    ))), null)
  }
  assert.equal(targetFor(orderedTuple.map(([key, value]) => (
    key === "view" ? [key, "list"] : [key, value]
  ))), null)
  assert.equal(targetFor(orderedTuple, 0), null)
})

test("observation route normalization and detail cleanup are runtime gated", () => {
  // Production break caught: runtime zero leaves a visible observation filter,
  // or task/track navigation retains stale observation detail coordinates.
  assert.equal(normalizeRegistrationWorkspaceCalendarKind("observation", 0), "all")
  assert.equal(normalizeRegistrationWorkspaceCalendarKind("observation", 1), "observation")
  assert.deepEqual(registrationWorkspaceRoute.REGISTRATION_WORKSPACE_DETAIL_KEYS, [
    "taskId", "trackId", "appointmentId", "observationId", "view",
  ])
  const next = buildRegistrationWorkspaceSearchParams(
    new URLSearchParams("taskId=t&trackId=r&appointmentId=a&observationId=o&view=calendar&fixture=x"),
    { mode: "list", view: "waiting", ownerScope: "mine" },
  )
  for (const key of registrationWorkspaceRoute.REGISTRATION_WORKSPACE_DETAIL_KEYS) {
    assert.equal(next.has(key), false)
  }
  assert.equal(next.get("fixture"), "x")
})

test("single observation attempt lookup runs once and fails closed on every URL relation mismatch", async () => {
  // Production break caught: a calendar target is authorized by recent-array
  // membership, retried client-side, or downgraded after a mismatched row.
  const resolveAttempt = registrationWorkspaceRoute.loadRegistrationObservationDeepLinkedAttempt
  assert.equal(typeof resolveAttempt, "function")
  const target = {
    kind: "observation",
    taskId: "10000000-0000-4000-8000-000000000001",
    trackId: "10000000-0000-4000-8000-000000000002",
    appointmentId: "10000000-0000-4000-8000-000000000003",
    observationId: "10000000-0000-4000-8000-000000000004",
    view: "calendar",
  }
  const valid = {
    taskId: target.taskId,
    trackId: target.trackId,
    observation: {
      taskId: target.taskId,
      trackId: target.trackId,
      appointmentId: target.appointmentId,
      observationId: target.observationId,
    },
  }
  const calls = []
  const resolved = await resolveAttempt(target, async (input) => {
    calls.push(input)
    return valid
  })
  assert.deepEqual(calls, [{ trackId: target.trackId, observationId: target.observationId }])
  assert.equal(resolved, valid.observation)

  for (const returned of [
    { ...valid, taskId: "40000000-0000-4000-8000-000000000001" },
    { ...valid, trackId: "40000000-0000-4000-8000-000000000002" },
    { ...valid, observation: { ...valid.observation, observationId: "40000000-0000-4000-8000-000000000003" } },
    { ...valid, observation: { ...valid.observation, appointmentId: "40000000-0000-4000-8000-000000000004" } },
  ]) {
    let mismatchCalls = 0
    assert.equal(await resolveAttempt(target, async () => {
      mismatchCalls += 1
      return returned
    }), null)
    assert.equal(mismatchCalls, 1)
  }

  let notFoundCalls = 0
  assert.equal(await resolveAttempt(target, async () => {
    notFoundCalls += 1
    throw Object.assign(new Error("not found"), { code: "P0002" })
  }), null)
  assert.equal(notFoundCalls, 1)
})

test("explicit canonical track deep links start before the workspace list is ready", () => {
  const target = getRegistrationDirectDeepLinkTarget({
    viewerId: "viewer-1",
    taskId: "task-1",
    trackId: "track-1",
    appointmentId: "",
    workspaceReady: false,
    currentSelectionKey: "",
  })

  assert.deepEqual(target, {
    kind: "track",
    taskId: "task-1",
    trackId: "track-1",
  })
  assert.equal(getRegistrationDirectDeepLinkTarget({
    viewerId: "viewer-1",
    taskId: "task-1",
    trackId: "legacy:task-1:영어",
    appointmentId: "",
    workspaceReady: false,
    currentSelectionKey: "",
  }), null)
  assert.equal(getRegistrationDirectDeepLinkTarget({
    viewerId: "viewer-1",
    taskId: "task-1",
    trackId: "track-1",
    appointmentId: "",
    workspaceReady: false,
    currentSelectionKey: "task-1:track-1",
  }), null)

  assert.deepEqual(getRegistrationDirectDeepLinkTarget({
    viewerId: "viewer-1",
    taskId: "task-1",
    trackId: "track-1",
    appointmentId: "",
    workspaceReady: true,
    currentSelectionKey: "",
  }), target)
})

test("task-only registration deep links start before the workspace list is ready", () => {
  const target = getRegistrationDirectDeepLinkTarget({
    viewerId: "viewer-1",
    taskId: "task-1",
    trackId: "",
    appointmentId: "",
    workspaceReady: false,
    currentSelectionKey: "",
  })

  assert.deepEqual(target, {
    kind: "case",
    taskId: "task-1",
  })
  assert.equal(getRegistrationDirectDeepLinkTarget({
    viewerId: "viewer-1",
    taskId: "task-1",
    trackId: "",
    appointmentId: "",
    workspaceReady: false,
    currentSelectionKey: "case:task-1",
  }), null)
  assert.deepEqual(getRegistrationDirectDeepLinkTarget({
    viewerId: "viewer-1",
    taskId: "task-1",
    trackId: "",
    appointmentId: "",
    workspaceReady: true,
    currentSelectionKey: "",
  }), target)
  assert.equal(getRegistrationDirectDeepLinkTarget({
    viewerId: "viewer-1",
    taskId: "task-1",
    trackId: "",
    appointmentId: "",
    workspaceReady: false,
    currentSelectionKey: "task-1:track-1",
  }), null)
})

test("direct registration details defer the competing workspace list until detail settles", () => {
  const shouldDefer = registrationWorkspaceRoute.shouldDeferRegistrationWorkspaceLoad
  assert.equal(typeof shouldDefer, "function")

  const baseInput = {
    viewerId: "viewer-1",
    taskId: "task-1",
    trackId: "track-1",
    appointmentId: "",
    workspaceReady: false,
  }
  assert.equal(shouldDefer?.({ ...baseInput, applicationHostKind: "closed" }), true)
  assert.equal(shouldDefer?.({ ...baseInput, applicationHostKind: "loading_detail" }), true)
  assert.equal(shouldDefer?.({ ...baseInput, applicationHostKind: "detail" }), false)
  assert.equal(shouldDefer?.({ ...baseInput, applicationHostKind: "refresh_failed" }), false)
  assert.equal(shouldDefer?.({ ...baseInput, workspaceReady: true, applicationHostKind: "closed" }), true)
  assert.equal(shouldDefer?.({ ...baseInput, trackId: "legacy:task-1:영어", applicationHostKind: "closed" }), false)
})

test("explicit appointment deep links start before the workspace list is ready", () => {
  const target = getRegistrationDirectDeepLinkTarget({
    viewerId: "viewer-1",
    taskId: "task-1",
    trackId: "",
    appointmentId: "appointment-1",
    workspaceReady: false,
    currentSelectionKey: "",
    currentAppointmentId: "",
  })

  assert.deepEqual(target, {
    kind: "appointment",
    taskId: "task-1",
    trackId: null,
    appointmentId: "appointment-1",
  })
  assert.equal(getRegistrationDirectDeepLinkTarget({
    viewerId: "viewer-1",
    taskId: "task-1",
    trackId: "track-1",
    appointmentId: "appointment-1",
    workspaceReady: false,
    currentSelectionKey: "task-1:track-1",
    currentAppointmentId: "appointment-1",
  }), null)

  assert.deepEqual(getRegistrationDirectDeepLinkTarget({
    viewerId: "viewer-1",
    taskId: "task-1",
    trackId: "",
    appointmentId: "appointment-1",
    workspaceReady: true,
    currentSelectionKey: "",
  }), target)
})

test("calendar target removes list state and preserves fixture context", () => {
  const original = "fixture=registration-subject-tracks&fixtureRole=english_admin&flow=waiting&owner=all&taskId=task-1&trackId=track-1&appointmentId=appointment-1&list=mine&focus=urgent"
  const current = new URLSearchParams(original)
  const next = buildRegistrationWorkspaceSearchParams(current, {
    mode: "calendar",
    calendarKind: "visit_consultation",
  })

  assert.equal(next.get("fixture"), "registration-subject-tracks")
  assert.equal(next.get("fixtureRole"), "english_admin")
  assert.equal(next.get("view"), "calendar")
  assert.equal(next.get("kind"), "visit_consultation")
  for (const key of ["flow", "owner", "taskId", "trackId", "appointmentId", "list", "focus"]) {
    assert.equal(next.has(key), false)
  }
  assert.equal(current.toString(), original)
})

test("calendar all target omits the default kind value", () => {
  const next = buildRegistrationWorkspaceSearchParams(
    new URLSearchParams("flow=inquiry&owner=all&kind=level_test"),
    { mode: "calendar", calendarKind: "all" },
  )

  assert.equal(next.get("view"), "calendar")
  assert.equal(next.has("kind"), false)
  assert.equal(next.has("flow"), false)
  assert.equal(next.has("owner"), false)
})

test("list targets restore flow and encode only explicit all scope", () => {
  const current = new URLSearchParams("fixture=x&view=calendar&kind=level_test&appointmentId=appointment-1")
  const all = buildRegistrationWorkspaceSearchParams(current, {
    mode: "list",
    view: "consultation_completed",
    ownerScope: "all",
  })
  assert.equal(all.get("flow"), "consultation_completed")
  assert.equal(all.get("owner"), "all")
  for (const key of ["view", "kind", "appointmentId"]) assert.equal(all.has(key), false)

  const mine = buildRegistrationWorkspaceSearchParams(all, {
    mode: "list",
    view: "consultation_requested",
    ownerScope: "mine",
  })
  assert.equal(mine.get("flow"), "consultation_requested")
  assert.equal(mine.has("owner"), false)

  const waiting = buildRegistrationWorkspaceSearchParams(all, {
    mode: "list",
    view: "waiting",
    ownerScope: "all",
  })
  assert.equal(waiting.has("owner"), false)
})
