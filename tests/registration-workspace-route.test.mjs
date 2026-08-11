import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

import ts from "typescript"

import * as registrationWorkspaceRoute from "../src/features/tasks/registration-workspace-route.ts"

import {
  buildRegistrationWorkspaceSearchParams,
  getRegistrationDirectDeepLinkTarget as getRegistrationDirectDeepLinkTargetRaw,
  isRegistrationConsultationViewKey,
  normalizeRegistrationConsultationOwnerScope,
  normalizeRegistrationWorkspaceCalendarKind,
} from "../src/features/tasks/registration-workspace-route.ts"

const require = createRequire(import.meta.url)

function createRouteHookHarness() {
  const slots = []
  let cursor = 0
  let pendingEffects = []

  function sameDependencies(left, right) {
    return Boolean(
      left
      && right
      && left.length === right.length
      && left.every((value, index) => Object.is(value, right[index])),
    )
  }

  function useRef(initialValue) {
    const index = cursor++
    if (!slots[index]) slots[index] = { kind: "ref", value: { current: initialValue } }
    return slots[index].value
  }

  function useEffect(effect, dependencies) {
    const index = cursor++
    const slot = slots[index]
    if (!slot || !sameDependencies(slot.dependencies, dependencies)) {
      pendingEffects.push({ effect, index })
      slots[index] = { kind: "effect", cleanup: slot?.cleanup, dependencies }
    }
  }

  return {
    react: { useEffect, useRef },
    render(hook, input) {
      assert.equal(pendingEffects.length, 0, "flush route effects before rendering again")
      cursor = 0
      hook(input)
    },
    flushEffects() {
      const effects = pendingEffects
      pendingEffects = []
      for (const { effect, index } of effects) {
        slots[index].cleanup?.()
        slots[index].cleanup = effect()
      }
    },
    cleanup() {
      for (const slot of slots) slot?.cleanup?.()
      pendingEffects = []
    },
  }
}

async function loadMountedRegistrationWorkspaceRoute(hookHarness) {
  const fileName = new URL("../src/features/tasks/registration-workspace-route.ts", import.meta.url)
  const source = await readFile(fileName, "utf8")
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: fileName.pathname,
  }).outputText
  const runtimeModule = { exports: {} }
  const runtimeRequire = (specifier) => {
    if (specifier === "react") return hookHarness.react
    return require(specifier)
  }
  const factory = vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, {
    filename: fileName.pathname,
  })
  factory(runtimeRequire, runtimeModule, runtimeModule.exports)
  return runtimeModule.exports
}

function createControlledPromise() {
  let resolve
  let reject
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function getRegistrationDirectDeepLinkTarget(input) {
  if (input.searchParams) return getRegistrationDirectDeepLinkTargetRaw(input)
  const searchParams = new URLSearchParams()
  if (input.taskId) searchParams.set("taskId", input.taskId)
  if (input.trackId) searchParams.set("trackId", input.trackId)
  if (input.appointmentId) searchParams.set("appointmentId", input.appointmentId)
  const state = { ...input }
  delete state.taskId
  delete state.trackId
  delete state.appointmentId
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

test("mounted observation route gate defers cold URLs and adjudicates each raw query once", async () => {
  // Production break caught: a cold runtime-1 deep link is rejected while the
  // runtime probe is pending, and a malformed URL repeatedly closes the host
  // because every render creates a fresh closed state.
  const hookHarness = createRouteHookHarness()
  const runtime = await loadMountedRegistrationWorkspaceRoute(hookHarness)
  assert.equal(typeof runtime.useRegistrationObservationRouteAdjudication, "function")

  const taskId = "11000000-0000-4000-8000-000000000001"
  const trackId = "11000000-0000-4000-8000-000000000002"
  const appointmentId = "11000000-0000-4000-8000-000000000003"
  const observationId = "11000000-0000-4000-8000-000000000004"
  const exactQuery = new URLSearchParams([
    ["taskId", taskId],
    ["trackId", trackId],
    ["appointmentId", appointmentId],
    ["observationId", observationId],
    ["view", "calendar"],
  ])
  const malformedQuery = new URLSearchParams(exactQuery)
  malformedQuery.append("observationId", observationId)
  let currentSelectionKey = ""
  const opened = []
  const rejected = []
  const onOpen = (target) => {
    opened.push(target)
    currentSelectionKey = `observation:${target.taskId}:${target.trackId}:${target.appointmentId}:${target.observationId}`
  }
  const onReject = (searchParams) => rejected.push(searchParams.toString())

  const render = ({ runtimeProbed, searchParams }) => {
    hookHarness.render(runtime.useRegistrationObservationRouteAdjudication, {
      enabled: true,
      viewerId: "viewer-1",
      searchParams,
      observationRuntimeVersion: 1,
      runtimeProbed,
      workspaceReady: false,
      currentSelectionKey,
      onOpen,
      onReject,
    })
    hookHarness.flushEffects()
  }

  try {
    render({ runtimeProbed: false, searchParams: exactQuery })
    render({ runtimeProbed: false, searchParams: exactQuery })
    assert.deepEqual(opened, [])
    assert.deepEqual(rejected, [])

    render({ runtimeProbed: true, searchParams: exactQuery })
    render({ runtimeProbed: true, searchParams: exactQuery })
    render({ runtimeProbed: true, searchParams: exactQuery })
    assert.equal(opened.length, 1)
    assert.equal(opened[0].observationId, observationId)
    assert.deepEqual(rejected, [])

    currentSelectionKey = ""
    render({ runtimeProbed: false, searchParams: malformedQuery })
    assert.deepEqual(rejected, [])
    render({ runtimeProbed: true, searchParams: malformedQuery })
    render({ runtimeProbed: true, searchParams: malformedQuery })
    render({ runtimeProbed: true, searchParams: malformedQuery })
    assert.deepEqual(rejected, [malformedQuery.toString()])
    assert.equal(opened.length, 1)
  } finally {
    hookHarness.cleanup()
  }
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

test("same observation id with changed coordinates starts a new exact read and fails closed", async () => {
  // Production break caught: observationId-only ownership suppresses a changed
  // task/track/appointment tuple, so the new coordinates are never rechecked.
  const observationId = "12000000-0000-4000-8000-000000000004"
  const previous = {
    taskId: "12000000-0000-4000-8000-000000000001",
    trackId: "12000000-0000-4000-8000-000000000002",
    appointmentId: "12000000-0000-4000-8000-000000000003",
  }
  const changed = {
    taskId: "13000000-0000-4000-8000-000000000001",
    trackId: "13000000-0000-4000-8000-000000000002",
    appointmentId: "13000000-0000-4000-8000-000000000003",
  }
  const searchParams = new URLSearchParams([
    ["taskId", changed.taskId],
    ["trackId", changed.trackId],
    ["appointmentId", changed.appointmentId],
    ["observationId", observationId],
    ["view", "calendar"],
  ])
  const target = getRegistrationDirectDeepLinkTargetRaw({
    viewerId: "viewer-1",
    searchParams,
    observationRuntimeVersion: 1,
    workspaceReady: true,
    currentSelectionKey: `observation:${previous.taskId}:${previous.trackId}:${previous.appointmentId}:${observationId}`,
    currentObservationId: observationId,
  })
  assert.deepEqual(target, {
    kind: "observation",
    ...changed,
    observationId,
    view: "calendar",
  })

  let calls = 0
  const attempt = await registrationWorkspaceRoute.loadRegistrationObservationDeepLinkedAttempt(
    target,
    async () => {
      calls += 1
      return {
        taskId: previous.taskId,
        trackId: previous.trackId,
        observation: {
          taskId: previous.taskId,
          trackId: previous.trackId,
          appointmentId: previous.appointmentId,
          observationId,
        },
      }
    },
  )
  assert.equal(calls, 1)
  assert.equal(attempt, null)
})

test("observation async ownership rejects A-B-A close runtime and viewer recycling", () => {
  // Production break caught: string equality lets the first A request commit
  // after B and a new A, or after close/reopen and runtime/viewer transitions.
  const createOwnership = registrationWorkspaceRoute.createRegistrationObservationAsyncOwnership
  assert.equal(typeof createOwnership, "function")
  const ownership = createOwnership()
  const a = {
    targetKey: "observation:task-a:track-a:appointment-a:observation-a",
    viewerId: "viewer-a",
    runtimeVersion: 1,
  }
  const b = {
    targetKey: "observation:task-b:track-b:appointment-b:observation-b",
    viewerId: "viewer-a",
    runtimeVersion: 1,
  }

  const firstA = ownership.begin(a)
  const requestB = ownership.begin(b)
  const secondA = ownership.begin(a)
  assert.equal(ownership.owns(firstA, a), false)
  assert.equal(ownership.owns(requestB, b), false)
  assert.equal(ownership.owns(secondA, a), true)

  ownership.invalidate()
  const reopenedA = ownership.begin(a)
  assert.equal(ownership.owns(secondA, a), false)
  assert.equal(ownership.owns(reopenedA, a), true)

  ownership.invalidate()
  const afterRuntimeBounce = ownership.begin(a)
  assert.equal(ownership.owns(reopenedA, a), false)
  assert.equal(ownership.owns(afterRuntimeBounce, { ...a, runtimeVersion: 0 }), false)
  assert.equal(ownership.owns(afterRuntimeBounce, { ...a, viewerId: "viewer-b" }), false)
  assert.equal(ownership.owns(afterRuntimeBounce, a), true)
})

test("observation async ownership commits only the newest mutation and releases failed reads", async () => {
  // Production break caught: two same-target mutation refreshes can commit in
  // completion order, while a failed owned read can leave the URL permanently
  // suppressed by a recyclable selection key.
  const createOwnership = registrationWorkspaceRoute.createRegistrationObservationAsyncOwnership
  assert.equal(typeof createOwnership, "function")
  const ownership = createOwnership()
  const context = {
    targetKey: "manager:task-a:track-a",
    viewerId: "viewer-a",
    runtimeVersion: 1,
  }
  const first = createControlledPromise()
  const second = createControlledPromise()
  const committed = []
  const run = async (request) => {
    const token = ownership.begin(context)
    try {
      const value = await request.promise
      if (ownership.owns(token, context)) committed.push(value)
    } catch {
      ownership.invalidate(token)
    }
  }

  const firstRun = run(first)
  const secondRun = run(second)
  second.resolve("second")
  await secondRun
  first.resolve("first")
  await firstRun
  assert.deepEqual(committed, ["second"])

  const failed = createControlledPromise()
  const failedRun = run(failed)
  failed.reject(new Error("not found"))
  await failedRun
  const retry = ownership.begin(context)
  assert.equal(ownership.owns(retry, context), true)
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
