import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

import { createElement } from "react"
import ts from "typescript"

import {
  createRegistrationCustomerReminderSettingsService,
} from "../src/features/notifications/registration-customer-reminder-service.ts"

const SETTINGS = Object.freeze({
  enabled: false,
  leadHours: 3,
  revision: "2",
  updatedAt: "2026-08-08T06:00:00.000Z",
  ready: false,
  status: "approval_pending",
  editable: true,
  activeKinds: Object.freeze(["observation_reminder"]),
})

const require = createRequire(import.meta.url)
const settingsPanelUrl = new URL(
  "../src/features/notifications/registration-customer-reminder-settings.tsx",
  import.meta.url,
)

function createMountedHookHarness() {
  const slots = []
  let cursor = 0
  let pendingEffects = []

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
      slots[index].value = typeof next === "function" ? next(slots[index].value) : next
    }]
  }

  function useEffect(effect, dependencies) {
    const index = cursor++
    const slot = slots[index]
    if (!slot || !sameDependencies(slot.dependencies, dependencies)) {
      pendingEffects.push({ effect, index })
      slots[index] = { kind: "effect", cleanup: slot?.cleanup, dependencies }
    }
  }

  function memo(factory, dependencies) {
    const index = cursor++
    const slot = slots[index]
    if (!slot || !sameDependencies(slot.dependencies, dependencies)) {
      slots[index] = { kind: "memo", value: factory(), dependencies }
    }
    return slots[index].value
  }

  return {
    react: {
      ...require("react"),
      useEffect,
      useMemo: memo,
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
      for (const slot of slots) slot?.cleanup?.()
      pendingEffects = []
    },
  }
}

function findMountedElement(node, predicate, description) {
  const matches = []
  const visit = (current) => {
    if (Array.isArray(current)) {
      current.forEach(visit)
    } else if (current && typeof current === "object" && "props" in current) {
      if (predicate(current)) matches.push(current)
      visit(current.props.children)
    }
  }
  visit(node)
  assert.equal(matches.length, 1, `expected one ${description}, received ${matches.length}`)
  return matches[0]
}

function mountedText(node, values = []) {
  if (Array.isArray(node)) node.forEach((child) => mountedText(child, values))
  else if (typeof node === "string" || typeof node === "number") values.push(String(node))
  else if (node && typeof node === "object" && "props" in node) mountedText(node.props.children, values)
  return values.join("")
}

async function flushMountedWork() {
  await new Promise((resolve) => setImmediate(resolve))
}

async function loadMountedSettingsPanel(fetch) {
  const source = await readFile(settingsPanelUrl, "utf8")
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: settingsPanelUrl.pathname,
  }).outputText
  const hookHarness = createMountedHookHarness()
  const passthrough = (tag) => function Passthrough({ children, ...props }) {
    return createElement(tag, props, children)
  }
  const runtimeModule = { exports: {} }
  const factory = vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, {
    filename: settingsPanelUrl.pathname,
  })
  const localModules = new Map([
    ["@radix-ui/react-switch", { Root: passthrough("button"), Thumb: passthrough("span") }],
    ["lucide-react", { Loader2: () => null }],
    ["@/components/ui/button", { Button: passthrough("button") }],
    ["@/components/ui/card", {
      Card: passthrough("section"),
      CardContent: passthrough("div"),
      CardHeader: passthrough("header"),
      CardTitle: passthrough("h2"),
    }],
    ["@/components/ui/input", { Input: passthrough("input") }],
    ["@/components/ui/label", { Label: passthrough("label") }],
    ["@/lib/supabase", {
      supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "mounted-token" } }, error: null }) } },
    }],
    ["./registration-customer-reminder-service", {
      createRegistrationCustomerReminderSettingsService(options) {
        return createRegistrationCustomerReminderSettingsService({ ...options, fetch })
      },
    }],
  ])
  factory((specifier) => {
    if (specifier === "react") return hookHarness.react
    if (specifier === "react/jsx-runtime") return require(specifier)
    const local = localModules.get(specifier)
    if (local) return local
    throw new Error(`unexpected reminder settings import: ${specifier}`)
  }, runtimeModule, runtimeModule.exports)
  return { hookHarness, Component: runtimeModule.exports.RegistrationCustomerReminderSettings }
}

test("disabled active kind in approval_pending allows one exact ON settings patch", async () => {
  const calls = []
  const enabledSettings = { ...SETTINGS, enabled: true, revision: "3", updatedAt: "2026-08-08T06:01:00.000Z" }
  const { hookHarness, Component } = await loadMountedSettingsPanel(async (_url, init) => {
    calls.push(init)
    return Response.json({ ok: true, settings: init.method === "GET" ? SETTINGS : enabledSettings })
  })

  try {
    hookHarness.render(Component)
    hookHarness.flushEffects()
    await flushMountedWork()
    let view = hookHarness.render(Component)
    const toggle = findMountedElement(
      view,
      (element) => element.props.id === "registration-customer-reminder-enabled",
      "automatic reminder toggle",
    )
    assert.equal(toggle.props.disabled, false)

    toggle.props.onCheckedChange(true)
    view = hookHarness.render(Component)
    const save = findMountedElement(
      view,
      (element) => typeof element.props.onClick === "function" && mountedText(element.props.children) === "저장",
      "save button",
    )
    save.props.onClick()
    await flushMountedWork()

    const patches = calls.filter((call) => call.method === "PATCH")
    assert.equal(patches.length, 1)
    assert.deepEqual(JSON.parse(patches[0].body), {
      enabled: true,
      leadHours: 3,
      expectedRevision: "2",
    })
  } finally {
    hookHarness.cleanup()
  }
})

test("설정 service는 access token을 사용하고 provider 식별자를 받지 않는다", async () => {
  const calls = []
  const service = createRegistrationCustomerReminderSettingsService({
    baseUrl: "https://tipsedu.co.kr",
    getAccessToken: async () => "access-token",
    fetch: async (url, init) => {
      calls.push({ url: String(url), init })
      return Response.json({ ok: true, settings: SETTINGS })
    },
  })

  assert.deepEqual(await service.get(), SETTINGS)
  assert.deepEqual(await service.update({ enabled: true, leadHours: 3, expectedRevision: "2" }), SETTINGS)
  assert.equal(calls[0].init.headers.Authorization, "Bearer access-token")
  assert.equal(calls[1].init.method, "PATCH")
  const updateRequest = calls[1].init
  assert.deepEqual(JSON.parse(updateRequest.body), {
    enabled: true,
    leadHours: 3,
    expectedRevision: "2",
  })
  assert.equal(updateRequest.body.includes("templateId"), false)
  assert.equal(updateRequest.body.includes("catalogChecksum"), false)
  assert.equal(updateRequest.body.includes("pfId"), false)
  assert.equal(calls.some(({ init }) => JSON.stringify(init).includes("templateId")), false)
})

test("설정 service는 누락·추가 필드가 있는 응답을 거절한다", async () => {
  for (const settings of [
    { ...SETTINGS, templateId: "unsafe" },
    { ...SETTINGS, leadHours: 0 },
    { ...SETTINGS, editable: "yes" },
  ]) {
    const service = createRegistrationCustomerReminderSettingsService({
      baseUrl: "https://tipsedu.co.kr",
      getAccessToken: async () => "access-token",
      fetch: async () => Response.json({ ok: true, settings }),
    })
    await assert.rejects(service.get(), /registration_customer_reminder_settings_invalid/)
  }
})

test("설정 조회와 저장은 서버가 멈춰도 제한시간 내 종료한다", async () => {
  const signals = []
  const service = createRegistrationCustomerReminderSettingsService({
    baseUrl: "https://tipsedu.co.kr",
    getAccessToken: async () => "access-token",
    timeoutMs: 5,
    fetch: async (_url, init) => {
      signals.push(init.signal)
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true })
      })
    },
  })

  await assert.rejects(service.get())
  await assert.rejects(service.update({ enabled: false, leadHours: 3, expectedRevision: "2" }))
  assert.equal(signals.length, 2)
  assert.equal(signals.every((signal) => signal?.aborted), true)
})

test("등록 알림 화면은 고객 자동 발송과 예약 N시간 전만 노출하고 내부 reminder rules를 숨긴다", async () => {
  const [panel, component] = await Promise.all([
    readFile(new URL("../src/features/notifications/notification-control-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/notifications/registration-customer-reminder-settings.tsx", import.meta.url), "utf8").catch(() => ""),
  ])

  assert.match(panel, /activeWorkflow === "registration"[\s\S]*RegistrationCustomerReminderSettings/)
  assert.match(panel, /rule\.eventKey !== "registration\.appointment_reminder_due"/)
  assert.doesNotMatch(panel, /현재 예약 알림이 발송되지 않습니다/)
  assert.match(component, />자동 발송 ON\/OFF</)
  assert.match(component, /예약[\s\S]*시간 전/)
  assert.match(component, /activeKindsLabel/)
  assert.match(component, /청강 리마인드/)
  assert.match(component, /min=\{1\}/)
  assert.match(component, /max=\{72\}/)
  assert.doesNotMatch(component, /전날|당일|분 전|대상 선택/)
})

test("발송 감사 문구는 자동은 자동 발송·시각, 수동은 요청 담당자·시각으로 읽힌다", async () => {
  const source = await readFile(
    new URL("../src/features/tasks/registration-alimtalk-preview-dialog.tsx", import.meta.url),
    "utf8",
  )

  assert.match(source, /confirmedByName === "자동 발송"/)
  assert.match(source, /자동 발송/)
  assert.match(source, /발송 요청 · \$\{confirmedByName\}/)
  assert.match(source, /formatAuditTimestamp\(auditMessage\.confirmedAt\)/)
  assert.doesNotMatch(source, />발송 요청 · \{auditMessage\.confirmedByName\}/)
})
