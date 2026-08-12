import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

import { JSDOM } from "jsdom"
import { act, createElement } from "react"
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

function passthrough(tag) {
  return function Passthrough({ children, ...props }) {
    return createElement(tag, props, children)
  }
}

async function loadRealSettingsPanel(fetch) {
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
  const SwitchRoot = ({ checked, children, onCheckedChange, ...props }) => createElement(
    "button",
    {
      ...props,
      "aria-checked": checked,
      onClick: () => onCheckedChange?.(!checked),
    },
    children,
  )
  const runtimeModule = { exports: {} }
  const factory = vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, {
    filename: settingsPanelUrl.pathname,
  })
  const localModules = new Map([
    ["@radix-ui/react-switch", { Root: SwitchRoot, Thumb: passthrough("span") }],
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
    if (specifier === "react") return require(specifier)
    if (specifier === "react/jsx-runtime") return require(specifier)
    const local = localModules.get(specifier)
    if (local) return local
    throw new Error(`unexpected reminder settings import: ${specifier}`)
  }, runtimeModule, runtimeModule.exports)
  return runtimeModule.exports.RegistrationCustomerReminderSettings
}

const DOM_GLOBALS = [
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

async function withSettingsDom(run) {
  const previous = new Map(DOM_GLOBALS.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://tipsedu.co.kr" })
  for (const key of DOM_GLOBALS) {
    const value = key === "IS_REACT_ACT_ENVIRONMENT"
      ? true
      : dom.window[key]
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const container = document.createElement("div")
  document.body.append(container)
  const { createRoot } = await import("react-dom/client")
  const root = createRoot(container)

  try {
    return await run({ container, root })
  } finally {
    await act(async () => { root.unmount() })
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
}

async function flushReactWork() {
  await new Promise((resolve) => setImmediate(resolve))
}

async function mountSettings(root, Component) {
  await act(async () => { root.render(createElement(Component)) })
  await act(async () => { await flushReactWork() })
}

test("real React settings keeps empty active kinds disabled without a PATCH", async () => {
  for (const status of ["approval_pending", "scheduler_pending"]) {
    const calls = []
    const Component = await loadRealSettingsPanel(async (_url, init) => {
      calls.push(init)
      return Response.json({
        ok: true,
        settings: { ...SETTINGS, activeKinds: [], status },
      })
    })

    await withSettingsDom(async ({ container, root }) => {
      await mountSettings(root, Component)
      const toggle = container.querySelector("#registration-customer-reminder-enabled")
      assert.ok(toggle)
      assert.equal(toggle.disabled, true)
      await act(async () => { toggle.click() })
      assert.equal(calls.filter((call) => call.method === "PATCH").length, 0)
    })
  }
})

test("real React settings permits an active kind and sends one exact ON PATCH", async () => {
  const calls = []
  const enabledSettings = { ...SETTINGS, enabled: true, revision: "3", updatedAt: "2026-08-08T06:01:00.000Z" }
  const Component = await loadRealSettingsPanel(async (_url, init) => {
    calls.push(init)
    return Response.json({ ok: true, settings: init.method === "GET" ? SETTINGS : enabledSettings })
  })

  await withSettingsDom(async ({ container, root }) => {
    await mountSettings(root, Component)
    const toggle = container.querySelector("#registration-customer-reminder-enabled")
    assert.ok(toggle)
    assert.equal(toggle.disabled, false)
    await act(async () => { toggle.click() })
    const save = [...container.querySelectorAll("button")].find((button) => button.textContent === "저장")
    assert.ok(save)
    assert.equal(save.disabled, false)
    await act(async () => { save.click(); await flushReactWork() })
    const patches = calls.filter((call) => call.method === "PATCH")
    assert.equal(patches.length, 1)
    assert.deepEqual(JSON.parse(patches[0].body), {
      enabled: true,
      leadHours: 3,
      expectedRevision: "2",
    })
  })
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
