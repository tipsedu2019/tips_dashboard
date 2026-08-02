import assert from "node:assert/strict"
import test from "node:test"

import {
  buildRegistrationWorkspaceSearchParams,
  getRegistrationDirectDeepLinkTarget,
  isRegistrationConsultationViewKey,
  normalizeRegistrationConsultationOwnerScope,
  normalizeRegistrationWorkspaceCalendarKind,
} from "../src/features/tasks/registration-workspace-route.ts"

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
    trackId: "track-1",
    appointmentId: "",
    workspaceReady: true,
    currentSelectionKey: "",
  }), null)
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
    appointmentId: "appointment-1",
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
