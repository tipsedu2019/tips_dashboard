import assert from "node:assert/strict"
import test from "node:test"
import * as React from "react"
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs"
import { normalizeRegistrationCaseContact } from "../src/features/tasks/registration-contact-client.ts"

const TASK = "99860000-0000-4000-8000-000000000001"
const OTHER_TASK = "99860000-0000-4000-8000-000000000002"
const TRACK = "99860000-0000-4000-8000-000000000003"
const STUDENT_A = "99860000-0000-4000-8000-000000000004"
const STUDENT_B = "99860000-0000-4000-8000-000000000005"
const ACTOR = "99860000-0000-4000-8000-000000000006"

function contact(overrides = {}) {
  const taskId = overrides.taskId ?? TASK
  return normalizeRegistrationCaseContact({
    version: 1, taskId, generation: "1", revision: "1", phase: "open",
    closureReason: null, closedAt: null, parentPhone: null, studentId: null,
    commonRevision: 1, allPhasesClosed: false, currentTrackIds: [TRACK], ...overrides,
  }, taskId)
}

const candidateA = Object.freeze({ id: STUDENT_A, name: "동명이인", school: "합성중", grade: "중2", uid: "S-A" })
const candidateB = Object.freeze({ id: STUDENT_B, name: "동명이인", school: "합성고", grade: "고1", uid: "S-B" })

function deferred() {
  let resolve, reject
  const promise = new Promise((success, failure) => { resolve = success; reject = failure })
  return { promise, resolve, reject }
}

// Execute the actual component and its handlers. Only React's in-memory hook
// scheduler and the explicit I/O boundary are controlled; role/contact helpers
// and shared UI imports retain their production implementations.
function hookHarness() {
  const slots = []
  let cursor = 0
  let effects = []
  const same = (left, right) => !!left && !!right && left.length === right.length
    && left.every((item, index) => Object.is(item, right[index]))
  const useState = (initial) => {
    const index = cursor++
    slots[index] ??= { value: typeof initial === "function" ? initial() : initial }
    return [slots[index].value, (next) => {
      slots[index].value = typeof next === "function" ? next(slots[index].value) : next
    }]
  }
  const useRef = (initial) => {
    const index = cursor++
    slots[index] ??= { value: { current: initial } }
    return slots[index].value
  }
  const memoHook = (factory, dependencies) => {
    const index = cursor++
    if (!slots[index] || !same(slots[index].dependencies, dependencies)) {
      slots[index] = { value: factory(), dependencies }
    }
    return slots[index].value
  }
  const useEffect = (effect, dependencies) => {
    const index = cursor++
    if (!slots[index] || !same(slots[index].dependencies, dependencies)) {
      effects.push({ effect, index })
      slots[index] = { dependencies, cleanup: slots[index]?.cleanup }
    }
  }
  return {
    react: { ...React, useState, useRef, useMemo: memoHook, useEffect,
      useId: () => useRef("synthetic-binding-control").current,
      useCallback: (callback, dependencies) => memoHook(() => callback, dependencies) },
    render(component, props) {
      assert.equal(effects.length, 0, "flush component effects before rerender")
      cursor = 0
      return component(props)
    },
    flushEffects() {
      const pending = effects
      effects = []
      for (const { effect, index } of pending) {
        slots[index].cleanup?.()
        slots[index].cleanup = effect()
      }
    },
    cleanup() {
      for (const slot of slots) slot?.cleanup?.()
      effects = []
    },
  }
}

function elements(node, predicate, output = []) {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, predicate, output)
  } else if (node && typeof node === "object" && "props" in node) {
    if (predicate(node)) output.push(node)
    elements(node.props.children, predicate, output)
  }
  return output
}

function one(node, predicate, description) {
  const matches = elements(node, predicate)
  assert.equal(matches.length, 1, `one ${description}, received ${matches.length}`)
  return matches[0]
}

function textContent(node) {
  if (Array.isArray(node)) return node.map(textContent).join(" ")
  if (typeof node === "string" || typeof node === "number") return String(node)
  return node && typeof node === "object" && "props" in node ? textContent(node.props.children) : ""
}

async function tick() { await new Promise(resolve => setImmediate(resolve)) }

function mount(overrides = {}) {
  const hooks = hookHarness()
  const runtime = loadNotificationComponent("src/features/tasks/registration-student-binding.tsx", new Map([
    ["react", hooks.react],
    ["./registration-track-service", {
      bindRegistrationStudent: () => assert.fail("test must inject the binding I/O boundary"),
      searchRegistrationStudentCandidates: () => assert.fail("test must inject the search I/O boundary"),
    }],
  ]))
  const calls = { searches: [], bindings: [], committed: [], dirty: [] }
  let props = {
    taskId: TASK, studentName: "문의 학생", viewerId: ACTOR, viewerRole: "staff", contactState: contact(),
    searchStudents: async (input) => {
      calls.searches.push(input)
      return { rows: [candidateA, candidateB], page: input.page ?? 1, pageSize: 20, totalCount: 2 }
    },
    bindStudent: async (input) => {
      calls.bindings.push(input)
      return { taskId: input.taskId, studentId: input.studentId, changed: true,
        contactState: contact({ taskId: input.taskId, studentId: input.studentId, revision: "2" }) }
    },
    onBound: (saved) => { calls.committed.push(saved) },
    onDirtyChange: (dirty) => { calls.dirty.push(dirty) },
    ...overrides,
  }
  let view
  const render = (patch = {}) => {
    props = { ...props, ...patch }
    view = hooks.render(runtime.RegistrationStudentBinding, props)
    return view
  }
  const flush = () => { hooks.flushEffects() }
  render()
  flush()
  return { calls, hooks, render, flush, get view() { return view }, get props() { return props }, cleanup: () => hooks.cleanup() }
}

function picker(view) { return one(view, node => node.type?.name === "SearchCombobox", "real shared student search combobox") }
function item(view, id) { return one(picker(view).props.children, node => node.type?.name === "SearchComboboxItem" && node.props.value === id, "explicit student UUID choice") }
function bindingButton(view) {
  return one(view, node => typeof node.props.onClick === "function" && /연결/.test(textContent(node))
    && node.type?.name !== "SearchCombobox", "explicit binding action")
}

async function openCandidates(fixture, clock) {
  picker(fixture.view).props.onOpenChange(true)
  fixture.render()
  fixture.flush()
  clock.tick(200)
  await tick()
  fixture.render()
  fixture.flush()
}

function choose(fixture, id = STUDENT_B) {
  item(fixture.view, id).props.onSelect(id)
  fixture.render()
  fixture.flush()
}

test("duplicate names require an explicit existing UUID and bind no contact or roster payload", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const fixture = mount({ contactState: contact({ parentPhone: "010-0000-0000" }) })
  try {
    assert.equal(fixture.calls.bindings.length, 0)
    await openCandidates(fixture, t.mock.timers)
    assert.equal(elements(picker(fixture.view).props.children, node => node.type?.name === "SearchComboboxItem").length, 2)
    assert.equal(fixture.calls.bindings.length, 0, "search/name match never infers a binding")
    choose(fixture, STUDENT_B)
    bindingButton(fixture.view).props.onClick()
    await tick()
    fixture.render()
    fixture.flush()
    assert.equal(fixture.calls.bindings.length, 1)
    const input = fixture.calls.bindings[0]
    assert.equal(input.taskId, TASK)
    assert.equal(input.studentId, STUDENT_B)
    assert.match(input.requestKey, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    assert.deepEqual(Object.keys(input).sort(), ["contactState", "requestKey", "studentId", "taskId"])
    assert.equal(input.contactState.parentPhone, null)
    assert.equal(JSON.stringify(input).includes("010-0000-0000"), false)
    assert.equal(fixture.calls.committed.length, 1)
    assert.equal(fixture.calls.committed[0].studentId, STUDENT_B)
    assert.equal(fixture.calls.committed[0].contactState.studentId, STUDENT_B)
    assert.equal(fixture.calls.committed[0].contactState.parentPhone, null)
    assert.equal(Object.hasOwn(fixture.calls.committed[0], "enrollmentFinalization"), false)
  } finally { fixture.cleanup() }
})

test("only admin and staff can select and explicitly bind an existing student", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  for (const viewerRole of ["admin", "staff"]) {
    const fixture = mount({ viewerRole })
    try {
      await openCandidates(fixture, t.mock.timers)
      choose(fixture, STUDENT_A)
      assert.equal(bindingButton(fixture.view).props.disabled, false)
      bindingButton(fixture.view).props.onClick()
      await tick()
      assert.equal(fixture.calls.bindings.length, 1)
      assert.equal(fixture.calls.bindings[0].studentId, STUDENT_A)
    } finally { fixture.cleanup() }
  }
  for (const viewerRole of ["teacher", "assistant", null]) {
    const fixture = mount({ viewerRole })
    try {
      const choices = elements(fixture.view, node => node.type?.name === "SearchCombobox")
      assert.ok(choices.length === 0 || choices.every(node => node.props.disabled === true))
      t.mock.timers.tick(200)
      await tick()
      assert.equal(fixture.calls.searches.length, 0)
      assert.equal(fixture.calls.bindings.length, 0)
    } finally { fixture.cleanup() }
  }
})

test("missing actor, unknown contact state and existing binding have no new selection", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  for (const props of [
    { viewerId: null }, { contactState: null },
    { contactState: { ...contact(), taskId: OTHER_TASK } },
    { contactState: { ...contact(), revision: "01" } },
    { contactState: contact({ studentId: STUDENT_A }) },
  ]) {
    const fixture = mount(props)
    try {
      const choices = elements(fixture.view, node => node.type?.name === "SearchCombobox")
      assert.ok(choices.length === 0 || choices.every(node => node.props.disabled === true))
      t.mock.timers.tick(200)
      await tick()
      assert.equal(fixture.calls.searches.length, 0)
      assert.equal(fixture.calls.bindings.length, 0)
    } finally { fixture.cleanup() }
  }
})

test("explicit UUID association on a closed case keeps its generation, phase and absent contact", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const closed = contact({ phase: "closed", closureReason: "whole_case_cancelled", closedAt: "2026-10-09T09:00:00Z" })
  const bindings = [], fixture = mount({ contactState: closed, bindStudent: async input => {
    bindings.push(input)
    return { taskId: input.taskId, studentId: input.studentId, changed: true,
      contactState: contact({ ...closed, studentId: input.studentId, revision: "2" }) }
  } })
  try {
    await openCandidates(fixture, t.mock.timers)
    choose(fixture, STUDENT_A)
    bindingButton(fixture.view).props.onClick()
    await tick(); fixture.render(); fixture.flush()
    assert.equal(bindings.length, 1)
    assert.equal(bindings[0].contactState.parentPhone, null)
    assert.equal(bindings[0].contactState.phase, "closed")
    assert.equal(fixture.calls.committed.length, 1)
    assert.equal(fixture.calls.committed[0].contactState.phase, "closed")
    assert.equal(fixture.calls.committed[0].contactState.generation, closed.generation)
    assert.equal(fixture.calls.committed[0].contactState.parentPhone, null)
    assert.equal(Object.hasOwn(bindings[0], "workflowStatus"), false)
  } finally { fixture.cleanup() }
})

test("candidate search uses one bounded page and displays only contact-free student fields", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const searches = []
  const fixture = mount({ searchStudents: async (input) => {
    searches.push(input)
    return { rows: [{ ...candidateA, contact: "010-0000-0001", parentContact: "010-0000-0002", parent_phone: "010-0000-0003" }],
      page: input.page, pageSize: 20, totalCount: 1 }
  } })
  try {
    await openCandidates(fixture, t.mock.timers)
    assert.equal(searches.length, 1)
    assert.equal(searches[0].page, 1)
    assert.equal(typeof searches[0].search, "string")
    assert.ok(searches[0].signal instanceof AbortSignal)
    assert.deepEqual(Object.keys(searches[0]).sort(), ["page", "search", "signal"])
    const display = JSON.stringify(fixture.view)
    for (const phone of ["010-0000-0001", "010-0000-0002", "010-0000-0003"]) assert.equal(display.includes(phone), false)
    const student = item(fixture.view, STUDENT_A)
    assert.ok(textContent(student).includes("동명이인"))
    assert.ok(textContent(student).includes("합성중"))
    assert.ok(textContent(student).includes("중2"))
    assert.ok(textContent(student).includes("S-A"))
  } finally { fixture.cleanup() }
})

test("a stale search result cannot replace the newer query's explicit UUID choices", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const first = deferred(), second = deferred(), searches = []
  const fixture = mount({ searchStudents: (input) => {
    searches.push(input)
    return searches.length === 1 ? first.promise : second.promise
  } })
  try {
    picker(fixture.view).props.onOpenChange(true)
    fixture.render(); fixture.flush(); t.mock.timers.tick(200); await tick()
    assert.equal(searches.length, 1)
    picker(fixture.view).props.onSearchValueChange("새 검색")
    fixture.render(); fixture.flush(); t.mock.timers.tick(200); await tick()
    assert.equal(searches.length, 2)
    assert.equal(searches[0].signal.aborted, true)
    second.resolve({ rows: [candidateB], page: 1, pageSize: 20, totalCount: 1 })
    await tick(); fixture.render(); fixture.flush()
    item(fixture.view, STUDENT_B)
    first.resolve({ rows: [candidateA], page: 1, pageSize: 20, totalCount: 1 })
    await tick(); fixture.render(); fixture.flush()
    assert.equal(elements(picker(fixture.view).props.children, node => node.props.value === STUDENT_A).length, 0)
    item(fixture.view, STUDENT_B)
    assert.equal(fixture.calls.bindings.length, 0)
  } finally { fixture.cleanup() }
})

test("twenty-row search pages replace choices and a query change resets to page one", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const searches = [], pageOne = Array.from({ length: 20 }, (_, index) => ({
    ...candidateA, id: index === 0 ? STUDENT_A : `99870000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    uid: `P1-${index}`,
  }))
  const fixture = mount({ searchStudents: async input => {
    searches.push(input)
    return { rows: input.page === 1 ? pageOne : [candidateB], page: input.page, pageSize: 20, totalCount: 21 }
  } })
  try {
    await openCandidates(fixture, t.mock.timers)
    assert.equal(elements(picker(fixture.view).props.children, node => node.type?.name === "SearchComboboxItem").length, 20)
    const next = one(picker(fixture.view).props.footer, node => typeof node.props.onClick === "function" && textContent(node) === "다음", "next bounded page")
    assert.equal(next.props.disabled, false)
    next.props.onClick()
    fixture.render(); fixture.flush(); t.mock.timers.tick(200); await tick(); fixture.render(); fixture.flush()
    assert.deepEqual(searches.map(input => input.page), [1, 2])
    assert.equal(elements(picker(fixture.view).props.children, node => node.type?.name === "SearchComboboxItem").length, 1)
    item(fixture.view, STUDENT_B)
    picker(fixture.view).props.onSearchValueChange("다른 검색")
    fixture.render(); fixture.flush()
    assert.equal(elements(picker(fixture.view).props.children, node => node.type?.name === "SearchComboboxItem").length, 0, "query switch immediately drops old page")
    t.mock.timers.tick(200); await tick(); fixture.render(); fixture.flush()
    assert.deepEqual(searches.map(input => input.page), [1, 2, 1])
    assert.equal(searches[2].search, "다른 검색")
    assert.equal(fixture.calls.bindings.length, 0)
  } finally { fixture.cleanup() }
})

test("search failure offers a real retry of the same query without preloading or binding", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const searches = [], fixture = mount({ searchStudents: async input => {
    searches.push(input)
    if (searches.length === 1) throw new Error("synthetic failed read")
    return { rows: [candidateA], page: input.page, pageSize: 20, totalCount: 1 }
  } })
  try {
    assert.equal(searches.length, 0, "closed popover never preloads student data")
    await openCandidates(fixture, t.mock.timers)
    assert.equal(searches.length, 1)
    const retry = one(picker(fixture.view).props.footer, node => typeof node.props.onClick === "function" && textContent(node) === "다시 불러오기", "failed search retry")
    retry.props.onClick()
    fixture.render(); fixture.flush(); t.mock.timers.tick(200); await tick(); fixture.render(); fixture.flush()
    assert.equal(searches.length, 2)
    assert.equal(searches[1].search, searches[0].search)
    assert.equal(searches[1].page, searches[0].page)
    assert.equal(searches[0].signal.aborted, true)
    item(fixture.view, STUDENT_A)
    assert.equal(fixture.calls.bindings.length, 0)
  } finally { fixture.cleanup() }
})

test("a stale candidate handler cannot select from a different search scope", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const fixture = mount({ searchStudents: async input => ({ rows: input.search ? [candidateA] : [candidateB], page: 1, pageSize: 20, totalCount: 1 }) })
  try {
    await openCandidates(fixture, t.mock.timers)
    const stale = item(fixture.view, STUDENT_B)
    picker(fixture.view).props.onSearchValueChange("갱신된 검색")
    fixture.render(); fixture.flush(); t.mock.timers.tick(200); await tick(); fixture.render(); fixture.flush()
    item(fixture.view, STUDENT_A)
    stale.props.onSelect(STUDENT_B)
    fixture.render(); fixture.flush()
    assert.notEqual(picker(fixture.view).props.selectedValue, STUDENT_B)
    assert.equal(bindingButton(fixture.view).props.disabled, true)
    assert.equal(fixture.calls.bindings.length, 0)
  } finally { fixture.cleanup() }
})

test("synchronous double submission creates only one attempted command", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const pending = deferred(), bindings = []
  const fixture = mount({ bindStudent: input => { bindings.push(input); return pending.promise } })
  try {
    await openCandidates(fixture, t.mock.timers)
    choose(fixture, STUDENT_A)
    const submit = bindingButton(fixture.view)
    submit.props.onClick()
    submit.props.onClick()
    await tick()
    assert.equal(bindings.length, 1, "disable on the next render cannot be the atomic in-flight guard")
    pending.resolve({ taskId: TASK, studentId: STUDENT_A, changed: true, contactState: contact({ studentId: STUDENT_A, revision: "2" }) })
    await tick()
    assert.equal(fixture.calls.committed.length, 1)
  } finally { fixture.cleanup() }
})

test("a captured submit handler cannot bind after its task or actor context changed", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  for (const patch of [{ taskId: OTHER_TASK, contactState: contact({ taskId: OTHER_TASK }) }, { viewerRole: "teacher" }]) {
    const fixture = mount()
    try {
      await openCandidates(fixture, t.mock.timers)
      choose(fixture, STUDENT_A)
      const submit = bindingButton(fixture.view)
      fixture.render(patch)
      fixture.flush()
      submit.props.onClick()
      await tick()
      assert.equal(fixture.calls.bindings.length, 0)
    } finally { fixture.cleanup() }
  }
})

test("failed or timed-out binding retains the original UUID, snapshot and request key for retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  for (const error of [new Error("registration_contact_mutation_timeout"), new Error("registration_contact_mutation_unavailable")]) {
    const bindings = []
    const fixture = mount({ bindStudent: async input => {
      bindings.push(input)
      if (bindings.length === 1) throw error
      return { taskId: input.taskId, studentId: input.studentId, changed: true,
        contactState: contact({ studentId: input.studentId, revision: "2" }) }
    } })
    try {
      await openCandidates(fixture, t.mock.timers)
      choose(fixture, STUDENT_B)
      bindingButton(fixture.view).props.onClick()
      await tick(); fixture.render(); fixture.flush()
      assert.equal(bindings.length, 1)
      assert.equal(fixture.calls.committed.length, 0)
      const pendingChoices = elements(fixture.view, node => node.type?.name === "SearchCombobox")
      assert.ok(pendingChoices.length === 0 || pendingChoices.every(node => node.props.disabled === true), "ambiguous attempt locks identity selection")
      bindingButton(fixture.view).props.onClick()
      await tick(); fixture.render(); fixture.flush()
      assert.equal(bindings.length, 2)
      assert.deepEqual(bindings[1], bindings[0], "retry preserves the complete attempted command")
      assert.equal(fixture.calls.committed.length, 1)
    } finally { fixture.cleanup() }
  }
})

test("task, generation, revision and actor switches discard pending identity and ignore its late result", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  for (const patch of [
    { taskId: OTHER_TASK, contactState: contact({ taskId: OTHER_TASK }) },
    { contactState: contact({ generation: "2" }) },
    { contactState: contact({ revision: "2" }) },
    { viewerId: "99860000-0000-4000-8000-000000000007" },
    { viewerRole: "teacher" },
  ]) {
    const pending = deferred(), bindings = []
    const fixture = mount({ bindStudent: input => { bindings.push(input); return pending.promise } })
    try {
      await openCandidates(fixture, t.mock.timers)
      choose(fixture, STUDENT_B)
      bindingButton(fixture.view).props.onClick()
      await tick()
      assert.equal(bindings.length, 1)
      fixture.render(patch)
      fixture.flush()
      fixture.render()
      fixture.flush()
      const scopedPicker = elements(fixture.view, node => node.type?.name === "SearchCombobox")
      for (const combo of scopedPicker) {
        assert.notEqual(combo.props.selectedValue, STUDENT_B)
        assert.equal(String(combo.props.triggerLabel).includes("S-B"), false)
      }
      pending.resolve({ taskId: TASK, studentId: STUDENT_B, changed: true, contactState: contact({ studentId: STUDENT_B, revision: "2" }) })
      await tick(); fixture.render(); fixture.flush()
      assert.equal(fixture.calls.committed.length, 0, "old-scope commit cannot update the new case or actor")
      assert.equal(bindings.length, 1)
    } finally { fixture.cleanup() }
  }
})

test("a refreshed contact context starts a fresh request instead of replaying the failed old identity", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const bindings = [], fixture = mount({ bindStudent: async input => {
    bindings.push(input)
    if (bindings.length === 1) throw new Error("registration_contact_mutation_timeout")
    return { taskId: input.taskId, studentId: input.studentId, changed: true,
      contactState: contact({ ...input.contactState, studentId: input.studentId, revision: String(BigInt(input.contactState.revision) + 1n) }) }
  } })
  try {
    await openCandidates(fixture, t.mock.timers)
    choose(fixture, STUDENT_B)
    bindingButton(fixture.view).props.onClick()
    await tick(); fixture.render(); fixture.flush()
    assert.equal(bindings.length, 1)
    fixture.render({ contactState: contact({ generation: "2", revision: "2" }) })
    fixture.flush(); fixture.render(); fixture.flush()
    await openCandidates(fixture, t.mock.timers)
    choose(fixture, STUDENT_A)
    bindingButton(fixture.view).props.onClick()
    await tick(); fixture.render(); fixture.flush()
    assert.equal(bindings.length, 2)
    assert.notEqual(bindings[1].requestKey, bindings[0].requestKey)
    assert.equal(bindings[1].studentId, STUDENT_A)
    assert.equal(bindings[1].contactState.generation, "2")
    assert.equal(bindings[1].contactState.revision, "2")
    assert.equal(fixture.calls.committed.length, 1)
    assert.equal(fixture.calls.committed[0].studentId, STUDENT_A)
  } finally { fixture.cleanup() }
})

test("a committed binding is acknowledged once even when its reload callback fails", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const committed = []
  const fixture = mount({ onBound: async saved => { committed.push(saved); throw new Error("synthetic reload failure") } })
  try {
    await openCandidates(fixture, t.mock.timers)
    choose(fixture, STUDENT_A)
    const submit = bindingButton(fixture.view)
    submit.props.onClick()
    await tick(); fixture.render(); fixture.flush()
    assert.equal(fixture.calls.bindings.length, 1)
    assert.equal(committed.length, 1)
    submit.props.onClick()
    await tick(); fixture.render(); fixture.flush()
    assert.equal(fixture.calls.bindings.length, 1, "acknowledged command cannot be resubmitted through an old handler")
    assert.equal(committed.length, 1)
    assert.equal(committed[0].contactState.parentPhone, null)
    assert.equal(committed[0].studentId, STUDENT_A)
  } finally { fixture.cleanup() }
})

test("an acknowledged binding focuses its status after the parent refreshes ownership metadata", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let saved, focuses = 0
  const fixture = mount({ onBound: result => { saved = result } })
  try {
    await openCandidates(fixture, t.mock.timers)
    choose(fixture, STUDENT_A)
    bindingButton(fixture.view).props.onClick()
    await tick()
    assert.ok(saved)
    fixture.render({ contactState: saved.contactState })
    const status = one(fixture.view, node => node.props.role === "status", "binding acknowledgement focus target")
    assert.equal(status.props.tabIndex, -1)
    status.props.ref.current = { focus() { focuses += 1 } }
    fixture.flush()
    assert.equal(focuses, 1)
    fixture.render(); fixture.flush()
    assert.equal(focuses, 1, "normal rerenders do not repeatedly steal focus")
    assert.equal(fixture.calls.bindings.length, 1)
  } finally { fixture.cleanup() }
})

test("mismatched UUID or raw contact in a returned acknowledgement is never committed", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  for (const invalid of [
    { taskId: OTHER_TASK, studentId: STUDENT_A, contactState: contact({ studentId: STUDENT_A, revision: "2" }) },
    { taskId: TASK, studentId: STUDENT_B, contactState: contact({ studentId: STUDENT_B, revision: "2" }) },
    { taskId: TASK, studentId: STUDENT_A, contactState: contact({ studentId: STUDENT_B, revision: "2" }) },
    { taskId: TASK, studentId: STUDENT_A, contactState: contact({ studentId: STUDENT_A, revision: "2", parentPhone: "010-0000-0099" }) },
  ]) {
    const fixture = mount({ bindStudent: async () => ({ changed: true, ...invalid }) })
    try {
      await openCandidates(fixture, t.mock.timers)
      choose(fixture, STUDENT_A)
      bindingButton(fixture.view).props.onClick()
      await tick(); fixture.render(); fixture.flush()
      assert.equal(fixture.calls.committed.length, 0)
      assert.equal(elements(fixture.view, node => node.props.role === "status").length, 0)
      assert.equal(JSON.stringify(fixture.view).includes("010-0000-0099"), false)
      assert.ok(elements(fixture.view, node => node.props.role === "alert").length > 0)
    } finally { fixture.cleanup() }
  }
})

test("unmount aborts search and ignores an in-flight binding acknowledgement", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const pending = deferred(), searches = []
  const fixture = mount({
    searchStudents: async input => { searches.push(input); return { rows: [candidateA], page: 1, pageSize: 20, totalCount: 1 } },
    bindStudent: () => pending.promise,
  })
  await openCandidates(fixture, t.mock.timers)
  choose(fixture, STUDENT_A)
  bindingButton(fixture.view).props.onClick()
  await tick()
  fixture.cleanup()
  assert.equal(searches[0].signal.aborted, true)
  pending.resolve({ taskId: TASK, studentId: STUDENT_A, changed: true, contactState: contact({ studentId: STUDENT_A, revision: "2" }) })
  await tick()
  assert.equal(fixture.calls.committed.length, 0)
})
