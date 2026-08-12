import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

import { JSDOM } from "jsdom"
import { act, createElement, forwardRef } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"

import {
  REGISTRATION_CUSTOMER_MESSAGE_KINDS,
  assertRegistrationCustomerMessagePublicPayload,
  parseRegistrationObservationSolapiReadiness,
} from "../src/features/tasks/registration-customer-message-contract.ts"
import { runRegistrationCustomerMessageRolloutAction } from "../src/features/tasks/registration-customer-message-rollout.ts"
import { createRegistrationCustomerMessageAdminClient } from "../src/features/tasks/registration-customer-message-service.ts"

const require = createRequire(import.meta.url)
const panelUrl = new URL("../src/features/tasks/registration-customer-message-rollout-panel.tsx", import.meta.url)

function passthrough(tag) {
  return forwardRef(function Passthrough({ children, ...props }, ref) {
    return createElement(tag, { ...props, ref }, children)
  })
}

const READINESS = Object.freeze({
  runtimeReady: true,
  settingsEnabled: true,
  leadHours: 3,
  schedule: Object.freeze({
    installed: true,
    active: true,
    contractReady: true,
    vaultReady: true,
    heartbeatCurrent: true,
    lastSucceededAt: "2026-08-12T00:00:00.000Z",
  }),
  bookingMode: "off",
  reminderMode: "verification",
  bookingReceipt: false,
  reminderReceipt: false,
  reminderCutoffAt: null,
  observationMessages: 0,
  providerAttemptMarkers: 0,
  pending: 1,
  sourceDirty: 2,
  deliveryUnknown: 3,
})

async function loadRolloutPanel(inspectObservationReadiness = async () => READINESS) {
  const source = await (await import("node:fs/promises")).readFile(panelUrl, "utf8")
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: panelUrl.pathname,
  }).outputText
  const Button = passthrough("button")
  const Input = passthrough("input")
  const Checkbox = forwardRef(function Checkbox({ onCheckedChange, ...props }, ref) {
    return createElement("input", { ...props, ref, onChange: () => onCheckedChange?.(true) })
  })
  const localModules = new Map([
    ["lucide-react", { Loader2: () => null, ShieldCheck: () => null }],
    ["@/components/ui/badge", { Badge: passthrough("span") }],
    ["@/components/ui/button", { Button }],
    ["@/components/ui/card", {
      Card: passthrough("section"),
      CardContent: passthrough("div"),
      CardDescription: passthrough("p"),
      CardHeader: passthrough("header"),
      CardTitle: passthrough("h2"),
    }],
    ["@/components/ui/checkbox", { Checkbox }],
    ["@/components/ui/input", { Input }],
    ["@/components/ui/label", { Label: passthrough("label") }],
    ["@/lib/supabase", { supabase: null }],
    ["@/providers/auth-provider", { useAuth: () => ({ isAdmin: true }) }],
    ["./registration-customer-message-service", {
      createRegistrationCustomerMessageAdminClient: () => ({ inspectObservationReadiness }),
    }],
    ["./registration-customer-message-rollout", {
      runRegistrationCustomerMessageRolloutAction: async () => undefined,
    }],
  ])
  const runtimeRequire = (specifier) => {
    if (specifier === "react" || specifier === "react/jsx-runtime") return require(specifier)
    const local = localModules.get(specifier)
    if (local) return local
    throw new Error(`unexpected rollout panel import: ${specifier}`)
  }
  const runtimeModule = { exports: {} }
  const factory = vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, {
    filename: panelUrl.pathname,
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

const ROLLOUT_DOM_GLOBALS = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Node",
  "Event",
  "MouseEvent",
  "getComputedStyle",
  "IS_REACT_ACT_ENVIRONMENT",
]

async function withRealRolloutDom(run) {
  const previous = new Map(ROLLOUT_DOM_GLOBALS.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://tipsedu.co.kr" })
  for (const key of ROLLOUT_DOM_GLOBALS) {
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key]
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const container = document.createElement("div")
  document.body.append(container)
  const { createRoot } = await import("react-dom/client")
  const root = createRoot(container)
  let unmounted = false
  const unmount = async () => {
    if (unmounted) return
    unmounted = true
    await act(async () => { root.unmount() })
  }

  try {
    return await run({ container, unmount, root })
  } finally {
    await unmount()
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
}

async function flushRealReactWork() {
  await new Promise((resolve) => setImmediate(resolve))
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return
    await flushRealReactWork()
  }
  assert.fail("timed out waiting for real React interaction")
}

async function loadRealRolloutPanel(client) {
  const source = await (await import("node:fs/promises")).readFile(panelUrl, "utf8")
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: panelUrl.pathname,
  }).outputText
  const Checkbox = forwardRef(function Checkbox({ checked, onCheckedChange, ...props }, ref) {
    return createElement("input", {
      ...props,
      ref,
      type: "checkbox",
      checked,
      onChange: (event) => onCheckedChange?.(event.target.checked),
    })
  })
  const runtimeModule = { exports: {} }
  const localModules = new Map([
    ["lucide-react", { Loader2: () => null, ShieldCheck: () => null }],
    ["@/components/ui/badge", { Badge: passthrough("span") }],
    ["@/components/ui/button", { Button: passthrough("button") }],
    ["@/components/ui/card", {
      Card: passthrough("section"),
      CardContent: passthrough("div"),
      CardDescription: passthrough("p"),
      CardHeader: passthrough("header"),
      CardTitle: passthrough("h2"),
    }],
    ["@/components/ui/checkbox", { Checkbox }],
    ["@/components/ui/input", { Input: passthrough("input") }],
    ["@/components/ui/label", { Label: passthrough("label") }],
    ["@/lib/supabase", { supabase: null }],
    ["@/providers/auth-provider", { useAuth: () => ({ isAdmin: true }) }],
    ["./registration-customer-message-service", {
      createRegistrationCustomerMessageAdminClient: () => client,
    }],
    ["./registration-customer-message-rollout", { runRegistrationCustomerMessageRolloutAction }],
  ])
  const runtimeRequire = (specifier) => {
    if (specifier === "react" || specifier === "react/jsx-runtime") return require(specifier)
    const local = localModules.get(specifier)
    if (local) return local
    throw new Error(`unexpected real rollout panel import: ${specifier}`)
  }
  const factory = vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, {
    filename: panelUrl.pathname,
  })
  factory(runtimeRequire, runtimeModule, runtimeModule.exports)
  return runtimeModule.exports.RegistrationCustomerMessageRolloutPanel
}

async function mountRealRolloutPanel(root, Component) {
  await act(async () => { root.render(createElement(Component)) })
  await act(async () => { await flushRealReactWork() })
}

function buttonWithText(container, text, occurrence = 0) {
  const button = [...container.querySelectorAll("button")]
    .filter((candidate) => candidate.textContent?.includes(text))[occurrence]
  assert.ok(button, `expected ${text} button`)
  return button
}

async function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
  assert.ok(setter)
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
    await flushRealReactWork()
  })
}

test("real React rollout aborts a preflight request on unmount before activation", async () => {
  const requests = []
  const client = createRegistrationCustomerMessageAdminClient({
    getAccessToken: async () => "access-token",
    adminTimeoutMs: 5,
    fetch: async (_url, init) => {
      requests.push(init)
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true })
      })
    },
  })
  const Component = await loadRealRolloutPanel(client)

  await withRealRolloutDom(async ({ container, root, unmount }) => {
    await mountRealRolloutPanel(root, Component)
    const taskId = container.querySelector("#verification-task-id")
    assert.ok(taskId)
    await setInputValue(taskId, "90000000-0000-4000-8000-000000000004")
    await act(async () => { buttonWithText(container, "템플릿 검증·테스트 허용", 5).click() })
    await waitFor(() => requests.length === 1)
    assert.equal(requests[0].body, JSON.stringify({ action: "preflight_template", messageKind: "observation_booking" }))

    await unmount()
    const abortedOnUnmount = requests[0].signal.aborted
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(abortedOnUnmount, true)
    assert.equal(requests.length, 1)
    assert.equal(container.innerHTML, "")
  })
})

test("real React rollout aborts after receipt and prevents the live activation request", async () => {
  const requests = []
  const receiptJson = createControlledPromise()
  const client = createRegistrationCustomerMessageAdminClient({
    getAccessToken: async () => "access-token",
    fetch: async (_url, init) => {
      requests.push(init)
      if (requests.length !== 1) throw new Error("activation request must not reach fetch after unmount")
      return {
        ok: true,
        json: () => receiptJson.promise,
      }
    },
  })
  const Component = await loadRealRolloutPanel(client)

  await withRealRolloutDom(async ({ container, root, unmount }) => {
    await mountRealRolloutPanel(root, Component)
    const messageId = container.querySelector("#message-id-observation_booking")
    assert.ok(messageId)
    await setInputValue(messageId, "90000000-0000-4000-8000-000000000005")
    const receipt = messageId.parentElement?.parentElement?.querySelector('input[type="checkbox"]')
    assert.ok(receipt)
    await act(async () => { receipt.click(); await flushRealReactWork() })
    await act(async () => { buttonWithText(container, "수신 확인·운영 전환", 5).click() })
    await waitFor(() => requests.length >= 1)
    assert.equal(requests[0].body.includes("record_live_test_receipt"), true)
    await unmount()
    const abortedOnUnmount = requests[0].signal.aborted
    receiptJson.resolve(READINESS)
    await flushRealReactWork()
    await flushRealReactWork()

    assert.equal(abortedOnUnmount, true)
    assert.equal(requests.length, 1)
    assert.equal(container.innerHTML, "")
  })
})

function createMountedRolloutHookHarness() {
  const slots = []
  let cursor = 0
  let pendingEffects = []
  let mounted = true
  let updatesAfterUnmount = 0

  function sameDependencies(left, right) {
    return Boolean(left && right && left.length === right.length && left.every((value, index) => (
      Object.is(value, right[index])
    )))
  }

  function useState(initialValue) {
    const index = cursor++
    if (!slots[index]) slots[index] = {
      kind: "state",
      value: typeof initialValue === "function" ? initialValue() : initialValue,
    }
    return [slots[index].value, (next) => {
      if (!mounted) {
        updatesAfterUnmount += 1
        return
      }
      slots[index].value = typeof next === "function" ? next(slots[index].value) : next
    }]
  }

  function useRef(initialValue) {
    const index = cursor++
    if (!slots[index]) slots[index] = { kind: "ref", value: { current: initialValue } }
    return slots[index].value
  }

  function memo(factory, dependencies) {
    const index = cursor++
    const slot = slots[index]
    if (!slot || !sameDependencies(slot.dependencies, dependencies)) {
      slots[index] = { kind: "memo", value: factory(), dependencies }
    }
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
    react: {
      ...require("react"),
      useCallback: (callback, dependencies) => memo(() => callback, dependencies),
      useEffect,
      useMemo: memo,
      useRef,
      useState,
    },
    render(Component) {
      assert.equal(pendingEffects.length, 0, "effects must flush before rerender")
      cursor = 0
      return Component({})
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
      mounted = false
      for (const slot of slots) slot?.cleanup?.()
      pendingEffects = []
    },
    get updatesAfterUnmount() {
      return updatesAfterUnmount
    },
  }
}

function mountedElements(node, predicate, matches = []) {
  if (Array.isArray(node)) node.forEach((child) => mountedElements(child, predicate, matches))
  else if (node && typeof node === "object" && "props" in node) {
    if (predicate(node)) matches.push(node)
    mountedElements(node.props.children, predicate, matches)
  }
  return matches
}

function mountedText(node, values = []) {
  if (Array.isArray(node)) node.forEach((child) => mountedText(child, values))
  else if (typeof node === "string" || typeof node === "number") values.push(String(node))
  else if (node && typeof node === "object" && "props" in node) mountedText(node.props.children, values)
  return values.join("")
}

function mountedButtonByText(view, text) {
  const buttons = mountedElements(view, (element) => (
    typeof element.props.onClick === "function" && mountedText(element.props.children).includes(text)
  ))
  assert.equal(buttons.length, 1, `expected one ${text} button, received ${buttons.length}`)
  return buttons[0]
}

function mountedPreparationButtons(view) {
  return mountedElements(view, (element) => (
    typeof element.props.onClick === "function"
    && mountedText(element.props.children).includes("템플릿 검증·테스트 허용")
  ))
}

function rolloutRow(view, messageKind) {
  const row = mountedElements(view, (element) => element.key === messageKind)
  assert.equal(row.length, 1, `expected one ${messageKind} rollout row, received ${row.length}`)
  return row[0]
}

function rolloutRowStatus(view, messageKind) {
  const row = rolloutRow(view, messageKind)
  const status = mountedElements(row, (element) => (
    ["꺼짐", "테스트 허용", "운영 중", "확인 필요"].includes(element.props.children)
  ))
  assert.equal(status.length, 1, `expected one ${messageKind} status, received ${status.length}`)
  return status[0].props.children
}

async function flushMountedWork() {
  await new Promise((resolve) => setImmediate(resolve))
}

async function loadMountedRolloutPanel({ inspectObservationReadiness, runAction }) {
  const source = await (await import("node:fs/promises")).readFile(panelUrl, "utf8")
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: panelUrl.pathname,
  }).outputText
  const hookHarness = createMountedRolloutHookHarness()
  const Button = passthrough("button")
  const Input = passthrough("input")
  const Checkbox = passthrough("input")
  const runtimeModule = { exports: {} }
  const localModules = new Map([
    ["lucide-react", { Loader2: () => null, ShieldCheck: () => null }],
    ["@/components/ui/badge", { Badge: passthrough("span") }],
    ["@/components/ui/button", { Button }],
    ["@/components/ui/card", {
      Card: passthrough("section"),
      CardContent: passthrough("div"),
      CardDescription: passthrough("p"),
      CardHeader: passthrough("header"),
      CardTitle: passthrough("h2"),
    }],
    ["@/components/ui/checkbox", { Checkbox }],
    ["@/components/ui/input", { Input }],
    ["@/components/ui/label", { Label: passthrough("label") }],
    ["@/lib/supabase", { supabase: null }],
    ["@/providers/auth-provider", { useAuth: () => ({ isAdmin: true }) }],
    ["./registration-customer-message-service", {
      createRegistrationCustomerMessageAdminClient: () => ({ inspectObservationReadiness }),
    }],
    ["./registration-customer-message-rollout", {
      runRegistrationCustomerMessageRolloutAction: runAction,
    }],
  ])
  const runtimeRequire = (specifier) => {
    if (specifier === "react") return hookHarness.react
    if (specifier === "react/jsx-runtime") return require(specifier)
    const local = localModules.get(specifier)
    if (local) return local
    throw new Error(`unexpected mounted rollout panel import: ${specifier}`)
  }
  const factory = vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, {
    filename: panelUrl.pathname,
  })
  factory(runtimeRequire, runtimeModule, runtimeModule.exports)
  return { hookHarness, Component: runtimeModule.exports.RegistrationCustomerMessageRolloutPanel }
}

test("rollout panel renders every customer message kind including both observation rows", async () => {
  const { MESSAGE_KIND_LABELS, RegistrationCustomerMessageRolloutPanel: RolloutPanel } = await loadRolloutPanel()
  const markup = renderToStaticMarkup(createElement(RolloutPanel))

  assert.equal(typeof MESSAGE_KIND_LABELS, "object")
  assert.deepEqual(Object.keys(MESSAGE_KIND_LABELS), REGISTRATION_CUSTOMER_MESSAGE_KINDS)

  for (const label of [
    "레벨테스트 예약 안내",
    "방문상담 예약 안내",
    "예약 리마인드",
    "대기 안내",
    "입학신청서 안내",
    "청강 예약 안내",
    "청강 리마인드",
  ]) {
    assert.match(markup, new RegExp(`>${label}<`))
  }
  assert.equal((markup.match(/>상태 새로고침</g) || []).length, 1)
})

test("readiness client sends only the exact read-only inspection action and rejects private output", async () => {
  const source = await (await import("node:fs/promises")).readFile(
    new URL("../src/features/tasks/registration-customer-message-service.ts", import.meta.url),
    "utf8",
  )
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const requests = []
  const runtimeModule = { exports: {} }
  const factory = vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, {
    filename: "registration-customer-message-service.ts",
  })
  factory((specifier) => {
    if (specifier === "./registration-customer-message-contract" || specifier === "./registration-customer-message-contract.ts") {
      return {
        assertRegistrationCustomerMessagePublicPayload,
        parseRegistrationObservationSolapiReadiness,
      }
    }
    throw new Error(`unexpected service import: ${specifier}`)
  }, runtimeModule, runtimeModule.exports)
  const client = runtimeModule.exports.createRegistrationCustomerMessageAdminClient({
    getAccessToken: async () => "access-token",
    fetch: async (_url, init) => {
      requests.push(init)
      return Response.json(READINESS)
    },
  })

  assert.deepEqual(await client.inspectObservationReadiness(), READINESS)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].body, JSON.stringify({ action: "inspect_observation_readiness" }))
  assert.equal(requests[0].body.includes("templateId"), false)
  assert.equal(requests[0].body.includes("pfId"), false)

  const privateClient = runtimeModule.exports.createRegistrationCustomerMessageAdminClient({
    getAccessToken: async () => "access-token",
    fetch: async () => Response.json({ ...READINESS, templateId: "private-template" }),
  })
  await assert.rejects(
    privateClient.inspectObservationReadiness(),
    /registration_customer_message_public_payload_forbidden_field:templateId/,
  )
})

test("readiness client forwards panel cancellation to its one read-only request", async () => {
  let resolveFetch
  let requestSignal
  let resolveStarted
  const started = new Promise((resolve) => { resolveStarted = resolve })
  const controller = new AbortController()
  const source = await (await import("node:fs/promises")).readFile(
    new URL("../src/features/tasks/registration-customer-message-service.ts", import.meta.url),
    "utf8",
  )
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const runtimeModule = { exports: {} }
  const factory = vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, {
    filename: "registration-customer-message-service.ts",
  })
  factory((specifier) => {
    if (specifier === "./registration-customer-message-contract" || specifier === "./registration-customer-message-contract.ts") {
      return {
        assertRegistrationCustomerMessagePublicPayload,
        parseRegistrationObservationSolapiReadiness,
      }
    }
    throw new Error(`unexpected service import: ${specifier}`)
  }, runtimeModule, runtimeModule.exports)
  const client = runtimeModule.exports.createRegistrationCustomerMessageAdminClient({
    getAccessToken: async () => "access-token",
    fetch: async (_url, init) => {
      requestSignal = init.signal
      resolveStarted()
      return new Promise((resolve) => { resolveFetch = resolve })
    },
  })
  const pending = client.inspectObservationReadiness(controller.signal)

  try {
    await started
    controller.abort("panel_unmounted")
    assert.equal(requestSignal.aborted, true)
    await assert.rejects(pending)
  } finally {
    resolveFetch?.(Response.json(READINESS))
    await pending.catch(() => undefined)
  }
})

test("rollout actions claim an exact row before rerender and settle distinct rows in response order", async () => {
  const first = createControlledPromise()
  const second = createControlledPromise()
  const actions = []
  const { hookHarness, Component } = await loadMountedRolloutPanel({
    inspectObservationReadiness: async () => READINESS,
    runAction: (client, input) => {
      actions.push({ client, input })
      return actions.length === 1 ? first.promise : second.promise
    },
  })
  const taskId = "90000000-0000-4000-8000-000000000001"

  try {
    let view = hookHarness.render(Component)
    hookHarness.flushEffects()
    const taskInput = mountedElements(view, (element) => element.props.id === "verification-task-id")[0]
    taskInput.props.onChange({ target: { value: taskId } })
    view = hookHarness.render(Component)
    const preparationButtons = mountedPreparationButtons(view)
    preparationButtons[0].props.onClick()
    preparationButtons[0].props.onClick()
    assert.equal(actions.length, 1)

    view = hookHarness.render(Component)
    const afterFirst = mountedPreparationButtons(view)
    assert.equal(afterFirst[1].props.disabled, false)
    afterFirst[1].props.onClick()
    assert.equal(actions.length, 2)

    second.resolve({})
    await flushMountedWork()
    view = hookHarness.render(Component)
    assert.equal(mountedElements(view, (element) => element.props.children === "테스트 허용").length, 1)

    first.resolve({})
    await flushMountedWork()
    view = hookHarness.render(Component)
    assert.equal(mountedElements(view, (element) => element.props.children === "테스트 허용").length, 2)
  } finally {
    hookHarness.cleanup()
  }
})

test("readiness refresh claims one request before rerender and does not update after unmount", async () => {
  const deferred = createControlledPromise()
  const requests = []
  const { hookHarness, Component } = await loadMountedRolloutPanel({
    inspectObservationReadiness: (signal) => {
      requests.push(signal)
      return deferred.promise
    },
    runAction: async () => ({}),
  })

  let view = hookHarness.render(Component)
  hookHarness.flushEffects()
  const refresh = mountedButtonByText(view, "상태 새로고침")
  refresh.props.onClick()
  refresh.props.onClick()
  assert.equal(requests.length, 1)
  hookHarness.cleanup()
  deferred.resolve(READINESS)
  await flushMountedWork()
  assert.equal(hookHarness.updatesAfterUnmount, 0)
})

test("rollout mutation completion never updates an unmounted panel", async () => {
  const deferred = createControlledPromise()
  const { hookHarness, Component } = await loadMountedRolloutPanel({
    inspectObservationReadiness: async () => READINESS,
    runAction: () => deferred.promise,
  })
  const taskId = "90000000-0000-4000-8000-000000000002"

  let view = hookHarness.render(Component)
  hookHarness.flushEffects()
  const taskInput = mountedElements(view, (element) => element.props.id === "verification-task-id")[0]
  taskInput.props.onChange({ target: { value: taskId } })
  view = hookHarness.render(Component)
  mountedPreparationButtons(view)[0].props.onClick()
  hookHarness.cleanup()
  deferred.resolve({})
  await flushMountedWork()
  assert.equal(hookHarness.updatesAfterUnmount, 0)
})

test("readiness hydrates observation rows from server modes and stale reload cannot overwrite a later row mutation", async () => {
  const staleRefresh = createControlledPromise()
  const mutation = createControlledPromise()
  const serverModes = {
    ...READINESS,
    bookingMode: "live",
    reminderMode: "verification",
  }
  const reloadedModes = {
    ...READINESS,
    bookingMode: "off",
    reminderMode: "live",
  }
  let refreshCount = 0
  const { hookHarness, Component } = await loadMountedRolloutPanel({
    inspectObservationReadiness: async () => {
      refreshCount += 1
      if (refreshCount === 1) return serverModes
      if (refreshCount === 2) return staleRefresh.promise
      return reloadedModes
    },
    runAction: () => mutation.promise,
  })

  try {
    let view = hookHarness.render(Component)
    hookHarness.flushEffects()
    mountedButtonByText(view, "상태 새로고침").props.onClick()
    await flushMountedWork()
    view = hookHarness.render(Component)
    assert.equal(rolloutRowStatus(view, "observation_booking"), "운영 중")
    assert.equal(rolloutRowStatus(view, "observation_reminder"), "테스트 허용")

    mountedButtonByText(view, "상태 새로고침").props.onClick()
    view = hookHarness.render(Component)
    const bookingRow = rolloutRow(view, "observation_booking")
    const disableBooking = mountedElements(bookingRow, (element) => (
      typeof element.props.onClick === "function" && mountedText(element.props.children) === "발송 끄기"
    ))
    assert.equal(disableBooking.length, 1)
    disableBooking[0].props.onClick()
    mutation.resolve({})
    await flushMountedWork()
    view = hookHarness.render(Component)
    assert.equal(rolloutRowStatus(view, "observation_booking"), "꺼짐")

    staleRefresh.resolve(serverModes)
    await flushMountedWork()
    view = hookHarness.render(Component)
    assert.equal(rolloutRowStatus(view, "observation_booking"), "꺼짐")
    assert.equal(rolloutRowStatus(view, "observation_reminder"), "테스트 허용")

    mountedButtonByText(view, "상태 새로고침").props.onClick()
    await flushMountedWork()
    view = hookHarness.render(Component)
    assert.equal(rolloutRowStatus(view, "observation_booking"), "꺼짐")
    assert.equal(rolloutRowStatus(view, "observation_reminder"), "운영 중")
  } finally {
    hookHarness.cleanup()
  }
})
