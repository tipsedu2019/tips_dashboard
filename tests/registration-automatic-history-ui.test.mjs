import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { act, createElement } from "react"
import { JSDOM } from "jsdom"
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs"

let dom, createRoot, RegistrationApplicationHistoryAction
const previousGlobals = new Map()

before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
  const globals = {
    ...Object.fromEntries([
      "window", "document", "navigator", "Node", "Element", "HTMLElement", "HTMLInputElement",
      "SVGElement", "NodeFilter", "Event", "CustomEvent", "MutationObserver",
    ].map((key) => [key, dom.window[key]])),
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  for (const [key, value] of Object.entries(globals)) {
    previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  // Load the actual Button, Popover, timeline, and Collapsible after installing
  // the DOM, so Radix uses its client effects. Only Supabase is replaced (null).
  ;({ createRoot } = await import("react-dom/client"))
  ;({ RegistrationApplicationHistoryAction } = loadNotificationComponent("src/features/tasks/registration-application-history-action.tsx"))
})

after(() => {
  dom?.window.close()
  for (const [key, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
})

function detailFixture() {
  const event = (id, eventType, overrides) => ({
    id, eventType, trackId: "english", subject: "영어", payloadVersion: 2,
    actorId: "known-actor", actorKind: "user", metadata: {}, ...overrides,
  })
  return {
    tracks: [{ id: "english", subject: "영어" }],
    events: [
      event("created", "case_created", { occurredAt: "2026-09-09T03:00:00Z" }),
      event("assigned", "director_default_resolved", {
        actorKind: "system", systemSource: "registration_director_defaults", occurredAt: "2026-09-08T03:00:00Z",
      }),
      event("old-actor", "waiting_started", { actorKind: null, payloadVersion: 1, occurredAt: "invalid" }),
      event("migrated", "track_closed", { actorKind: "migration", occurredAt: null }),
      event("internal", "notification_delivery", { occurredAt: "2026-09-10T03:00:00Z", reason: "PRIVATE_PROVIDER_RECEIPT" }),
    ],
  }
}

async function flush(action) {
  await act(async () => { action?.() })
  await act(async () => {
    // Allow the committed Radix effects to install outside-pointer listeners
    // and complete deferred focus restoration before the next interaction.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function mount(t, detail = detailFixture()) {
  const host = dom.window.document.createElement("div")
  dom.window.document.body.append(host)
  const root = createRoot(host)
  const original = structuredClone(detail)
  const fetch = t.mock.method(globalThis, "fetch", () => { assert.fail("history must not request or send data") })
  let submissions = 0
  await flush(() => root.render(createElement("form", {
    onSubmit(event) { event.preventDefault(); submissions++ },
  },
  createElement(RegistrationApplicationHistoryAction, { detail, profiles: [{ id: "known-actor", label: "담당 직원" }] }),
  createElement("button", { type: "button", "data-outside": "" }, "다른 업무"))))
  t.after(async () => {
    await flush(() => root.unmount())
    host.remove()
    assert.equal(fetch.mock.callCount(), 0)
    assert.equal(submissions, 0, "opening and inspecting history must not submit the surrounding form")
    assert.deepEqual(detail, original, "history inspection must not change the case")
  })
  const document = dom.window.document
  return {
    document,
    trigger: host.querySelector('button[aria-label="자동 이력 보기"]'),
    outside: host.querySelector("[data-outside]"),
    timeline: () => document.querySelector('section[aria-label="등록 자동 이력"]'),
  }
}

test("automatic history opens one read-only timeline with honest actors and times, excluding provider events", async (t) => {
  const view = await mount(t)
  assert.ok(view.trigger)
  assert.equal(view.trigger.type, "button")
  assert.equal(view.timeline(), null)
  await flush(() => view.trigger.click())
  assert.equal(view.trigger.getAttribute("aria-expanded"), "true")
  assert.equal(view.document.querySelectorAll('section[aria-label="등록 자동 이력"]').length, 1)
  const timeline = view.timeline()
  const rows = [...timeline.querySelectorAll(":scope > ol > li")]
  assert.equal(rows.length, 4)
  const created = rows.find((row) => row.textContent.includes("등록 문의 생성"))
  assert.match(created.querySelector("p").textContent, /담당 직원 · 2026\. 09\. 09\./u)
  const assigned = rows.find((row) => row.textContent.includes("상담 책임자 자동 배정"))
  assert.match(assigned.querySelector("p").textContent, /시스템 · 상담 책임자 자동 배정/u)
  const unknown = rows.find((row) => row.textContent.includes("대기 시작"))
  assert.equal(unknown.querySelector("p").textContent, "알 수 없음 · 시간 확인 불가")
  const migrated = rows.find((row) => row.textContent.includes("등록 흐름 종료"))
  assert.equal(migrated.querySelector("p").textContent, "마이그레이션 · 시간 확인 불가")
  assert.equal(timeline.querySelectorAll("input, textarea, select, a, [contenteditable]").length, 0)
  assert.equal(timeline.querySelectorAll("button").length, 0, "events without saved detail do not show empty disclosure controls")
  assert.doesNotMatch(timeline.textContent, /PRIVATE_PROVIDER_RECEIPT|notification_delivery|known-actor/u)
})

test("Escape restores history-trigger focus while outside interaction keeps focus on the next action", async (t) => {
  const view = await mount(t)
  await flush(() => { view.trigger.focus(); view.trigger.click() })
  await flush(() => view.document.activeElement.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
  assert.equal(view.timeline(), null)
  assert.equal(view.trigger.getAttribute("aria-expanded"), "false")
  assert.ok(view.document.activeElement === view.trigger, "Escape restores focus to the history trigger")
  await flush(() => view.trigger.click())
  await flush(() => {
    view.outside.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    view.outside.focus()
    view.outside.click()
  })
  assert.equal(view.timeline(), null)
  assert.ok(view.document.activeElement === view.outside, "outside interaction retains the chosen action's focus")
})

test("an empty case opens an explicit empty automatic history without edit or send controls", async (t) => {
  const view = await mount(t, { tracks: [], events: [] })
  await flush(() => view.trigger.click())
  assert.match(view.timeline().textContent, /아직 자동 이력이 없습니다/u)
  assert.equal(view.timeline().querySelectorAll("button, input, textarea, select, a").length, 0)
})

test("safe creation and legacy titles survive Escape and reopen without raw JSON or empty disclosures", async (t) => {
  const detail = detailFixture()
  detail.events.push(
    { id: "case", eventType: "registration_case_created", payloadVersion: 1,
      actorId: "known-actor", actorKind: "user", occurredAt: "2026-10-09T01:02:03Z", metadata: {} },
    { id: "broken", eventType: "registration_case_created", payloadVersion: null,
      legacyText: '{"campus":"PRIVATE_BROKEN","actorId":', metadata: {} },
    { id: "future", eventType: "registration_case_created", payloadVersion: null,
      legacyText: '{"version":99,"campus":"PRIVATE_FUTURE"}', metadata: {} },
    { id: "prose", eventType: "track_closed", payloadVersion: null,
      legacyText: "보호자 요청으로 문의 종료", metadata: {} },
    { id: "null", eventType: "registration_case_created", payloadVersion: null,
      legacyText: null, metadata: {} },
  )
  const view = await mount(t, detail)
  for (let cycle = 0; cycle < 3; cycle++) {
    await flush(() => { view.trigger.focus(); view.trigger.click() })
    const timeline = view.timeline()
    assert.ok(timeline)
    assert.equal(view.document.querySelectorAll('section[aria-label="등록 자동 이력"]').length, 1)
    const rows = [...timeline.querySelectorAll(":scope > ol > li")]
    assert.equal(rows.length, 9)
    const created = rows.find(row => row.querySelector("p").textContent.includes("2026. 10. 09."))
    assert.equal(created.querySelector("span").textContent, "등록 문의 생성")
    assert.match(created.querySelector("p").textContent, /담당 직원 · 2026\. 10\. 09\./u)
    assert.match(timeline.textContent, /보호자 요청으로 문의 종료/u)
    assert.equal(rows.filter(row => row.querySelector("span").textContent === "등록 문의 생성").length, 5)
    assert.equal(timeline.querySelectorAll("button").length, 0, "creation records with no saved detail keep the PR96 empty-disclosure rule")
    assert.doesNotMatch(timeline.textContent, /PRIVATE_|actorId|campus|version|\[object Object\]/u)
    await flush(() => view.document.activeElement.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    assert.equal(view.timeline(), null)
    assert.ok(view.document.activeElement === view.trigger)
  }
})

test("manual state changes show the actual transition without opening a redundant disclosure", async (t) => {
  const detail = detailFixture();
  detail.events = [{ id: "manual", eventType: "registration_workflow_status_changed", trackId: "english", subject: "영어", source: "observation_requested", destination: "inquiry_only", actorKind: "user", actorId: "known-actor", occurredAt: "2026-10-04T14:00:00Z", payloadVersion: 2, metadata: {} }];
  const view = await mount(t, detail);
  await flush(() => view.trigger.click());
  assert.match(view.timeline().textContent, /청강 신청 → 문의만/u);
  assert.equal(view.timeline().querySelectorAll("button").length, 0);
});
