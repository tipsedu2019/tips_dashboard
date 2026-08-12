import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

import { createElement, forwardRef } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"

import {
  REGISTRATION_CUSTOMER_MESSAGE_KINDS,
  assertRegistrationCustomerMessagePublicPayload,
  parseRegistrationObservationSolapiReadiness,
} from "../src/features/tasks/registration-customer-message-contract.ts"

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
