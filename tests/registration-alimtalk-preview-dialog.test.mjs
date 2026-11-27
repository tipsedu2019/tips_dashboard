import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

import { act, createElement, forwardRef } from "react"
import ts from "typescript"
import { createRegistrationCustomerMessageClient } from "../src/features/tasks/registration-customer-message-service.ts"
import { formatRegistrationMessageTimestamp } from "../src/features/tasks/registration-customer-message-labels.ts"
import * as customerMessageErrors from "../src/features/tasks/registration-customer-message-errors.ts"

const require = createRequire(import.meta.url)
const { JSDOM } = require("jsdom")

const dialogUrl = new URL("../src/features/tasks/registration-alimtalk-preview-dialog.tsx", import.meta.url)
const sharedDialogUrl = new URL("../src/components/ui/dialog.tsx", import.meta.url)
const fixturesUrl = new URL("../src/features/tasks/registration-track-fixtures.ts", import.meta.url)

// Initialize React DOM after JSDOM so its real input-event capability detection
// sees the browser environment; administrator form checks use native events.
async function createMountedRoot(container) {
  const { createRoot } = await import("react-dom/client")
  return createRoot(container)
}

async function sourceOrEmpty(url) {
  try {
    return await readFile(url, "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") return ""
    throw error
  }
}

async function loadMountedDialog() {
  const source = await sourceOrEmpty(dialogUrl)
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: dialogUrl.pathname,
  }).outputText
  const Button = forwardRef(function MountedButton({ children, ...props }, ref) {
    return createElement("button", { ...props, ref }, children)
  })
  const Dialog = ({ open, children }) => open ? createElement("div", null, children) : null
  const Wrapper = forwardRef(function MountedWrapper({ children, ...props }, ref) {
    delete props.overlayClassName
    delete props.showCloseButton
    delete props.onEscapeKeyDown
    return createElement("div", { ...props, ref }, children)
  })
  const Content = forwardRef(function MountedContent(props, ref) {
    return createElement(Wrapper, { ...props, ref, role: "dialog", tabIndex: -1, "data-slot": "dialog-content" })
  })
  const Title = forwardRef(function MountedTitle({ children, ...props }, ref) {
    return createElement("h2", { ...props, ref, "data-slot": "dialog-title" }, children)
  })
  const runtimeModule = { exports: {} }
  const localModules = new Map([
    ["@/components/ui/button", { Button }],
    ["@/components/ui/dialog", {
      Dialog,
      DialogClose: ({ children }) => children,
      DialogContent: Content,
      DialogDescription: Wrapper,
      DialogFooter: Wrapper,
      DialogHeader: Wrapper,
      DialogTitle: Title,
    }],
    ["./registration-customer-message-errors", customerMessageErrors],
    ["./registration-customer-message-labels", { formatRegistrationMessageTimestamp }],
  ])
  const runtimeRequire = (specifier) => {
    if (specifier === "react" || specifier === "react/jsx-runtime") return require(specifier)
    const local = localModules.get(specifier)
    if (local) return local
    throw new Error(`unexpected mounted dialog import: ${specifier}`)
  }
  const factory = vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, {
    filename: dialogUrl.pathname,
  })
  factory(runtimeRequire, runtimeModule, runtimeModule.exports)
  return runtimeModule.exports.RegistrationAlimtalkPreviewDialog
}

function observationPreview(sourceId, className = "중2 영어 A반") {
  return {
    ok: true,
    previewId: "d6400000-0000-4000-8000-000000000001",
    expiresAt: "2099-08-12T00:10:00.000Z",
    messageKind: "observation_booking",
    studentName: sourceId === "d6400000-0000-4000-8000-000000000003" ? "두번째 학생" : "첫번째 학생",
    recipientLast4: "5678",
    facts: {
      subjectLabel: "영어",
      className,
      scheduleLabel: "2026년 8월 17일 월요일 오후 6:00",
      placeLabel: "본관 301호",
      teacherLabel: "홍길동",
    },
    body: `청강 예약 안내 ${className}`,
    buttons: [{ name: "학원 위치 보기", type: "WL", host: "map.naver.com" }, { name: "문의하기", type: "WL", host: "tipsedu.channel.io" }],
    readiness: {
      runtimeReady: true,
      activationMode: "live",
      activationEligible: true,
      credentialsConfigured: true,
      pfConfigured: true,
      templateConfigured: true,
      templateVerified: true,
      verifiedAt: "2026-08-12T00:00:00.000Z",
      sourceValid: true,
      sendAllowed: true,
      blockers: [],
    },
    latestMessage: null,
  }
}

function controlledPromise() {
  let resolve
  const promise = new Promise((onResolve) => { resolve = onResolve })
  return { promise, resolve }
}

test("mounted observation dialog ignores a stale preview and one confirmation gesture can call send only once", async () => {
  const Dialog = await loadMountedDialog()
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>")
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document
  const originalNavigator = globalThis.navigator
  const originalCrypto = globalThis.crypto
  const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto")
  const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
  const first = controlledPromise()
  const second = controlledPromise()
  const previewCalls = []
  let sendCalls = 0
  let deliveryCalls = 0
  const delivery = controlledPromise()
  const client = {
    preview(target) {
      previewCalls.push(target)
      return target.sourceId === "d6400000-0000-4000-8000-000000000002" ? first.promise : second.promise
    },
    async send() {
      sendCalls += 1
      return {
        ok: true,
        messageId: "d6400000-0000-4000-8000-000000000004",
        messageKind: "observation_booking",
        currentStatus: "accepted",
        recipientLast4: "5678",
        confirmedByName: "김관리",
        confirmedAt: "2026-08-12T00:01:00.000Z",
        updatedAt: "2026-08-12T00:01:00.000Z",
        canCheck: false,
        idempotent: false,
      }
    },
    async checkDelivery() { deliveryCalls += 1; return delivery.promise },
    async check() { throw new Error("not used") },
    async reconcile() { throw new Error("not used") },
    async releasePreSend() { throw new Error("not used") },
  }
  let root

  globalThis.window = dom.window
  globalThis.document = dom.window.document
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator })
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: dom.window.crypto })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  const render = async (sourceId) => act(async () => {
    root.render(createElement(Dialog, {
      open: true,
      onOpenChange: () => undefined,
      target: { messageKind: "observation_booking", sourceId },
      client,
      viewerRole: "staff",
    }))
    await new Promise((resolve) => setImmediate(resolve))
  })

  try {
    root = await createMountedRoot(dom.window.document.getElementById("root"))
    await render("d6400000-0000-4000-8000-000000000002")
    await render("d6400000-0000-4000-8000-000000000003")
    await act(async () => {
      second.resolve(observationPreview("d6400000-0000-4000-8000-000000000003", "중2 영어 B반"))
      await second.promise
    })
    await act(async () => {
      first.resolve(observationPreview("d6400000-0000-4000-8000-000000000002"))
      await first.promise
    })
    assert.match(dom.window.document.body.textContent, /두번째 학생/)
    assert.match(dom.window.document.body.textContent, /중2 영어 B반/)
    assert.match(dom.window.document.body.textContent, /홍길동/)
    assert.doesNotMatch(dom.window.document.body.textContent, /첫번째 학생/)

    const confirm = [...dom.window.document.querySelectorAll("button")]
      .find((button) => button.textContent === "확인 후 발송")
    assert.ok(confirm)
    await act(async () => {
      confirm.click()
      confirm.click()
      await new Promise((resolve) => setImmediate(resolve))
    })
    assert.equal(sendCalls, 1)
    assert.deepEqual(previewCalls, [
      { messageKind: "observation_booking", sourceId: "d6400000-0000-4000-8000-000000000002" },
      { messageKind: "observation_booking", sourceId: "d6400000-0000-4000-8000-000000000003" },
    ])
    assert.match(dom.window.document.body.textContent, /발송 요청 · 김관리/)
    const checkDelivery = [...dom.window.document.querySelectorAll("button")].find((button) => button.textContent === "전달 결과 확인")
    assert.ok(checkDelivery, "accepted receipt must offer delivery lookup even when legacy canCheck is false")
    await act(async () => { checkDelivery.click(); checkDelivery.click() })
    assert.equal(deliveryCalls, 1)
    await act(async () => {
      delivery.resolve({ ok: true, deliveryStatus: "delivered", checkedAt: "2026-09-07T00:00:00.000Z" })
      await delivery.promise
    })
    assert.match(dom.window.document.body.textContent, /알림톡 전달 완료/)
    assert.equal(sendCalls, 1, "receipt checks must never resend")
    await render("d6400000-0000-4000-8000-000000000002")
    assert.doesNotMatch(dom.window.document.body.textContent, /알림톡 전달 완료/)
  } finally {
    if (root) await act(async () => root.unmount())
    dom.window.close()
    globalThis.window = originalWindow
    globalThis.document = originalDocument
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator })
    if (originalCryptoDescriptor) {
      Object.defineProperty(globalThis, "crypto", originalCryptoDescriptor)
    } else {
      Reflect.deleteProperty(globalThis, "crypto")
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
  }
  assert.strictEqual(globalThis.crypto, originalCrypto)
})

test("registration customer message client sends only strict target and confirmation DTOs", async () => {
  const calls = []
  const client = createRegistrationCustomerMessageClient({
    getAccessToken: async () => "fixture-token",
    fetch: async (url, init) => {
      calls.push({ url, init: { ...init, headers: { ...init.headers } } })
      return {
        ok: true,
        json: async () => url.includes("/messages?")
          ? ({ ok: true, messageKind: "waiting_notice", readiness: { sendAllowed: false }, history: [{ messageId: "history-message" }] })
          : ({ ok: true, messageId: "message" }),
      }
    },
  })

  await client.preview({ messageKind: "level_test_booking", sourceId: "source-id" })
  await client.send({ previewId: "preview-id", requestKey: "request-key" })
  const history = await client.list({ messageKind: "waiting_notice", sourceId: "waiting-id" })
  await client.check({ messageId: "message-id" })
  await client.reconcile({
    messageId: "message-id",
    resolution: "accepted",
    evidence: {
      statusCode: "200",
      statusMessage: "accepted",
      observedAt: "2026-08-05T00:00:00.000Z",
      requestKeyMatched: true,
    },
    reason: "관리자 확인",
    requestKey: "admin-request-key",
  })
  await client.releasePreSend({
    messageId: "message-id",
    reason: "사전 발송 해제",
    requestKey: "release-request-key",
  })

  assert.equal(JSON.stringify(history), JSON.stringify([{ messageId: "history-message" }]))

  assert.deepEqual(calls.map(({ url, init }) => [url, init.method, init.body]), [
    ["/api/solapi/registration/preview", "POST", JSON.stringify({ messageKind: "level_test_booking", sourceId: "source-id" })],
    ["/api/solapi/registration/send", "POST", JSON.stringify({ previewId: "preview-id", requestKey: "request-key" })],
    ["/api/solapi/registration/messages?messageKind=waiting_notice&sourceId=waiting-id", "GET", undefined],
    ["/api/solapi/registration/check", "POST", JSON.stringify({ messageId: "message-id" })],
    ["/api/solapi/registration/admin", "POST", JSON.stringify({
      action: "reconcile",
      messageId: "message-id",
      resolution: "accepted",
      evidence: {
        statusCode: "200",
        statusMessage: "accepted",
        observedAt: "2026-08-05T00:00:00.000Z",
        requestKeyMatched: true,
      },
      reason: "관리자 확인",
      requestKey: "admin-request-key",
    })],
    ["/api/solapi/registration/admin", "POST", JSON.stringify({
      action: "release_pre_send",
      messageId: "message-id",
      reason: "사전 발송 해제",
      requestKey: "release-request-key",
    })],
  ])
  assert.equal(calls.every(({ init }) => init.headers.Authorization === "Bearer fixture-token"), true)
  assert.equal(calls.every(({ init }) => !String(init.body || "").match(/phone|template|body/i)), true)
})

test("registration customer message client whitelists DTO fields and rejects private response fields", async () => {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, body: init.body })
    return {
      ok: true,
      json: async () => ({ ok: true, messageId: "message", parentPhone: "01012345678" }),
    }
  }
  const client = createRegistrationCustomerMessageClient({ getAccessToken: async () => "fixture-token", fetch })

  await assert.rejects(
    client.preview({ messageKind: "level_test_booking", sourceId: "source-id", phone: "01012345678" }),
    /registration_customer_message_public_payload_forbidden_field:parentPhone/,
  )
  assert.equal(calls[0].body, JSON.stringify({ messageKind: "level_test_booking", sourceId: "source-id" }))

  const reconciler = createRegistrationCustomerMessageClient({ getAccessToken: async () => "fixture-token", fetch })
  await assert.rejects(reconciler.reconcile({
    action: "release_pre_send",
    messageId: "message-id",
    resolution: "accepted",
    evidence: {
      statusCode: "200",
      statusMessage: "accepted",
      observedAt: "2026-08-05T00:00:00.000Z",
      requestKeyMatched: true,
      rawProviderResponse: "never-send",
    },
    reason: "관리자 확인",
    requestKey: "admin-request-key",
  }), /registration_customer_message_public_payload_forbidden_field:parentPhone/)
  assert.match(calls[1].body, /^\{"action":"reconcile","messageId":"message-id","resolution":"accepted","evidence":\{"statusCode":"200","statusMessage":"accepted","observedAt":"2026-08-05T00:00:00.000Z","requestKeyMatched":true\},"reason":"관리자 확인","requestKey":"admin-request-key"\}$/)
})

test("preview dialog remains a controlled accessible presentation surface", async () => {
  const source = await sourceOrEmpty(dialogUrl)

  assert.match(source, /export function RegistrationAlimtalkPreviewDialog/)
  assert.match(source, /open:\s*boolean/)
  assert.match(source, /onOpenChange:\s*\(open:\s*boolean\)/)
  assert.match(source, /target:\s*RegistrationCustomerMessageTarget\s*\|\s*null/)
  assert.match(source, /SOLAPI 접수 완료/)
  assert.match(source, /학부모 전화 끝/)
  assert.match(source, /전달 결과 확인/)
  assert.match(source, /발송 요청 ·/)
  assert.match(source, /confirmedByName/)
  assert.match(source, /confirmedAt/)
  assert.match(source, /이미 발송 요청됨/)
  assert.match(source, /currentStatus === "accepted"/)
  assert.match(source, /발송 결과 확인 필요/)
  assert.match(source, /발송 실패 · 같은 내용 재발송 불가/)
  assert.match(source, /role="alert"/)
  assert.match(source, /role="status"/)
  assert.match(source, /whitespace-pre-wrap break-words/)
  assert.match(source, /min-h-11/)
  assert.match(source, /onEscapeKeyDown/)
  assert.match(source, /requestKeyRef/)
  assert.match(source, /generationRef/)
  assert.match(source, /triggerRef/)
  assert.match(source, /onSendSuccess\?:/)
  assert.match(source, /generation !== generationRef\.current[\s\S]*confirmationLockedRef\.current = true[\s\S]*applyResult\(next\)[\s\S]*onSendSuccess/)
  assert.match(source, /알림톡은 접수됐지만 최신 내용을 불러오지 못했습니다/)
  assert.match(source, /setTimeout/)
  assert.match(source, /showCloseButton=\{false\}/)
  assert.match(source, /<DialogClose asChild>/)
  assert.match(source, /min-w-11/)
  assert.match(source, /currentStatus === "unknown" && canCheck/)
  assert.match(source, /currentStatus === "pending" && canCheck/)
  assert.match(source, /canReleasePreSend\?: boolean/)
  assert.match(source, /canReleasePreSend \?\? false/)
  assert.match(source, /setRecoveryResolution\("accepted"\)/)
  assert.match(source, /setRecoveryStatus\(""\)/)
  assert.match(source, /setRecoveryMessage\(""\)/)
  assert.match(source, /setRecoveryObservedAt\(""\)/)
  assert.match(source, /setRecoveryRequestKeyMatched\(""\)/)
  assert.match(source, /setRecoveryProviderMessageId\(""\)/)
  assert.match(source, /setRecoveryProviderGroupId\(""\)/)
  assert.match(source, /recoveryRequestKeyMatched === "true"/)
  assert.doesNotMatch(source, /<option value="false">/)
  assert.match(source, /currentStatus === "pending"/)
  assert.match(source, /resolution: recoveryResolution/)
  assert.match(source, /reconcile/)
  assert.match(source, /releasePreSend/)
  assert.doesNotMatch(source, /fetch\(\s*["']\/api\/solapi\/registration/)
  assert.doesNotMatch(source, /parentPhone|templateId|renderedBody/)
})

test("알림톡 미리보기의 배경과 내용은 등록 상세 모달보다 위에 열린다", async () => {
  const [source, sharedDialogSource] = await Promise.all([
    sourceOrEmpty(dialogUrl),
    sourceOrEmpty(sharedDialogUrl),
  ])

  assert.match(sharedDialogSource, /overlayClassName\?:\s*string/)
  assert.match(
    source,
    /<DialogContent[\s\S]*?overlayClassName="z-\[90\]"[\s\S]*?className="z-\[90\][^"]*"/,
  )
})

test("입학 미리보기는 정규 수업 정보를 먼저 보여주고 첫 수업일을 마지막에 강조한다", async () => {
  const source = await sourceOrEmpty(dialogUrl)
  const admissionSection = source.slice(source.indexOf("preview.facts.admissionPlans?.map"))
  const labels = ["과목/수업 · ", "교재 · ", "요일/시간 · ", "선생님 · ", "강의실 · ", "첫 수업일 · "]
  const positions = labels.map((label) => admissionSection.indexOf(label))

  assert.equal(positions.every((position) => position >= 0), true)
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right))
  assert.match(source, /preview\.facts\.admissionPlans\?\.map/)
  assert.match(source, /className="mt-2 border-t pt-2 font-semibold"/)
  assert.match(source, /className="whitespace-pre-wrap break-words rounded-md border bg-muted\/30 p-3"/)
})

test("미리보기의 모든 실패 경로는 내부 오류 코드를 운영자 안내로 바꾼다", async () => {
  const source = await sourceOrEmpty(dialogUrl)

  assert.match(source, /getRegistrationCustomerMessageErrorMessage/)
  assert.equal((source.match(/setError\(getRegistrationCustomerMessageErrorMessage\(/g) || []).length, 6)
})

test("등록 fixture도 입학 수업정보와 모든 문의하기 버튼을 실제 미리보기처럼 제공한다", async () => {
  const source = await sourceOrEmpty(fixturesUrl)

  assert.match(source, /admissionPlans:\s*\[/)
  assert.match(source, /subjectLabel:\s*"영어"[\s\S]*className:\s*"중2 영어 A반"/)
  assert.match(source, /textbookLabel:\s*"능률 VOCA"/)
  assert.match(source, /scheduleLabel:\s*"월·수 오후 6:00–8:00"/)
  assert.match(source, /teacherLabel:\s*"홍길동"/)
  assert.match(source, /classroomLabel:\s*"본관 301호"/)
  assert.match(source, /firstLessonLabel:\s*"8월 17일 월요일 오후 6:00–8:00"/)
  assert.equal((source.match(/host:\s*"tipsedu\.channel\.io"/g) || []).length, 7)
})

const RECOVERY_SOURCE_A = "d6400000-0000-4000-8000-000000000012"
const RECOVERY_SOURCE_B = "d6400000-0000-4000-8000-000000000013"
const RECOVERY_NOW = Date.parse("2026-10-29T08:00:00.000Z")
const CONFLICT_CODE = "registration_customer_message_confirmation_conflict"

function recoveryPreview(ordinal = 1, overrides = {}) {
  return {
    ...observationPreview(RECOVERY_SOURCE_A, `합성 수업 ${ordinal}`),
    previewId: `d6400000-0000-4000-8000-${String(100 + ordinal).padStart(12, "0")}`,
    expiresAt: new Date(RECOVERY_NOW + 60_000).toISOString(),
    studentName: `합성 학생 ${ordinal}`,
    ...overrides,
  }
}

function recoveryReceipt(overrides = {}) {
  return { ok: true, messageId: "d6400000-0000-4000-8000-000000000201", messageKind: "observation_booking",
    currentStatus: "accepted", recipientLast4: "5678", confirmedByName: "합성 담당자",
    confirmedAt: new Date(RECOVERY_NOW).toISOString(), updatedAt: new Date(RECOVERY_NOW).toISOString(),
    canCheck: false, idempotent: false, ...overrides }
}

function recoveryHttpError(code, status = 409) {
  return Response.json({ ok: false, code }, { status })
}

async function mountRecoveryDialog(t, { previews, sends = [], props: overrides = {} }) {
  const Dialog = await loadMountedDialog()
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>")
  const globalKeys = ["window", "document", "navigator", "crypto", "IS_REACT_ACT_ENVIRONMENT", "fetch"]
  const descriptors = Object.fromEntries(globalKeys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  let now = RECOVERY_NOW
  let keyNumber = 0
  let timerNumber = 0
  const timers = new Map()
  const calls = { preview: [], send: [], other: [], external: 0 }
  const previewQueue = [...previews]
  const sendQueue = [...sends]
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator })
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID: () => `d6400000-0000-4000-8000-${String(300 + ++keyNumber).padStart(12, "0")}` } })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.fetch = async () => { calls.external += 1; throw new Error("External transport forbidden") }
  t.mock.method(Date, "now", () => now)
  dom.window.setTimeout = (callback, delay = 0) => {
    const id = ++timerNumber
    timers.set(id, { callback, at: now + Number(delay) })
    return id
  }
  dom.window.clearTimeout = id => timers.delete(id)
  const client = createRegistrationCustomerMessageClient({
    getAccessToken: async () => "synthetic-session",
    fetch: async (url, init) => {
      assert.equal(init.method, "POST")
      const stage = url === "/api/solapi/registration/preview" ? "preview"
        : url === "/api/solapi/registration/send" ? "send" : "other"
      calls[stage].push({ body: JSON.parse(init.body), signal: init.signal })
      assert.notEqual(stage, "other", `Unexpected synthetic action ${url}`)
      const queue = stage === "preview" ? previewQueue : sendQueue
      assert.ok(queue.length, `No synthetic ${stage} response remains`)
      const next = await queue.shift()
      if (next instanceof Error) throw next
      if (next && Object.hasOwn(next, "throws")) throw next.throws
      return next instanceof Response ? next : Response.json(next)
    },
  })
  let props = { open: true, target: { messageKind: "observation_booking", sourceId: RECOVERY_SOURCE_A },
    client, viewerRole: "staff", ...overrides }
  const root = await createMountedRoot(dom.window.document.getElementById("root"))
  const paint = () => root.render(createElement(Dialog, { ...props, onOpenChange(next) { props = { ...props, open: next }; paint() } }))
  const flush = async () => act(async () => { await new Promise(resolve => setImmediate(resolve)) })
  const button = label => [...dom.window.document.querySelectorAll("button")].find(node => node.textContent === label)
  const click = async (label, times = 1) => {
    const node = button(label)
    assert.ok(node, `Expected button: ${label}`)
    await act(async () => { for (let i = 0; i < times; i++) node.click(); await new Promise(resolve => setImmediate(resolve)) })
  }
  t.after(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    for (const key of globalKeys) {
      if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key])
      else Reflect.deleteProperty(globalThis, key)
    }
    assert.equal(calls.external, 0)
    assert.deepEqual(calls.other, [])
  })
  await act(async () => { paint(); await new Promise(resolve => setImmediate(resolve)) })
  return {
    calls, dom, button, click, flush,
    text: () => dom.window.document.body.textContent,
    async render(patch) { props = { ...props, ...patch }; await act(async () => { paint(); await new Promise(resolve => setImmediate(resolve)) }) },
    async resolve(pending, value) { await act(async () => { pending.resolve(value); await pending.promise; await new Promise(resolve => setImmediate(resolve)) }) },
    async advance(ms, runTimers = true) {
      now += ms
      if (runTimers) await act(async () => {
        for (const [id, timer] of [...timers]) {
          if (timer.at <= now) { timers.delete(id); timer.callback() }
        }
        await new Promise(resolve => setImmediate(resolve))
      })
    },
  }
}

test("preview load failure offers one manual retry and never sends automatically", async t => {
  const retry = controlledPromise()
  const view = await mountRecoveryDialog(t, { previews: [new Error("synthetic preview failure"), retry.promise],
    props: { target: { messageKind: "admission_application", sourceId: RECOVERY_SOURCE_A } } })
  assert.match(view.text(), /미리보기를 불러오지 못했습니다/)
  assert.equal(view.calls.preview.length, 1)
  assert.equal(view.button("확인 후 발송").disabled, true)
  await view.click("미리보기 다시 확인", 2)
  assert.equal(view.calls.preview.length, 2, "Repeated click must share the in-flight retry")
  assert.ok(view.calls.preview[1].signal instanceof AbortSignal)
  assert.deepEqual(view.calls.preview[1].body, { messageKind: "admission_application", sourceId: RECOVERY_SOURCE_A })
  assert.equal(view.calls.send.length, 0)
  await view.resolve(retry, recoveryPreview(2, { messageKind: "admission_application" }))
  assert.match(view.text(), /합성 학생 2/)
  assert.doesNotMatch(view.text(), /미리보기를 불러오지 못했습니다/)
  assert.equal(view.button("확인 후 발송").disabled, false)
  assert.equal(view.calls.send.length, 0, "A new preview still requires a human confirmation click")
})

test("preview expiry displays its time and manual refresh replaces expired consent", async t => {
  const initial = recoveryPreview()
  const view = await mountRecoveryDialog(t, { previews: [initial, recoveryPreview(2, { expiresAt: new Date(RECOVERY_NOW + 120_000).toISOString() })] })
  await view.advance(60_001)
  const expiry = [...view.dom.window.document.querySelectorAll("time")].find(node => node.dateTime === initial.expiresAt)
  assert.ok(expiry, "Expiry notice must expose the actual server-provided time")
  assert.match(expiry.textContent, /17:01/)
  assert.match(view.text(), /미리보기.*만료|만료.*미리보기/)
  assert.equal(view.button("확인 후 발송").disabled, true)
  assert.equal(view.calls.preview.length, 1, "Expiry never creates a preview automatically")
  await view.click("미리보기 다시 확인")
  assert.equal(view.calls.preview.length, 2)
  assert.equal(view.calls.send.length, 0)
  assert.equal(view.button("확인 후 발송").disabled, false)
})

test("confirmation checks the expiry at click time before a throttled timer runs", async t => {
  const view = await mountRecoveryDialog(t, { previews: [recoveryPreview()], sends: [recoveryReceipt()] })
  assert.equal(view.button("확인 후 발송").disabled, false)
  await view.advance(60_001, false)
  await view.click("확인 후 발송")
  assert.equal(view.calls.send.length, 0, "An enabled DOM button must not send a now-expired receipt")
  assert.equal(view.calls.preview.length, 1)
  assert.match(view.text(), /만료/)
  assert.ok(view.button("미리보기 다시 확인"))
})

test("exact confirmation conflict refreshes once and only a new human click sends the new preview", async t => {
  const refresh = controlledPromise()
  const secondSend = controlledPromise()
  const view = await mountRecoveryDialog(t, { previews: [recoveryPreview(), refresh.promise],
    sends: [recoveryHttpError(CONFLICT_CODE), secondSend.promise] })
  await view.click("확인 후 발송", 2)
  assert.equal(view.calls.send.length, 1)
  assert.equal(view.calls.preview.length, 2, "Exact conflict must automatically fetch one replacement preview")
  assert.equal(view.button("확인 후 발송")?.disabled ?? true, true)
  await view.resolve(refresh, recoveryPreview(2))
  assert.match(view.text(), /합성 학생 2/)
  assert.equal(view.calls.send.length, 1)
  await view.click("확인 후 발송", 2)
  assert.equal(view.calls.send.length, 2)
  assert.notEqual(view.calls.send[1].body.requestKey, view.calls.send[0].body.requestKey)
  assert.equal(view.calls.send[1].body.previewId, recoveryPreview(2).previewId)
  await view.resolve(secondSend, recoveryReceipt())
  assert.match(view.text(), /SOLAPI 접수 완료/)
  assert.equal(view.calls.preview.length, 2)
})

test("conflict replacement failure discards old consent and waits for a manual preview retry", async t => {
  const view = await mountRecoveryDialog(t, { previews: [recoveryPreview(), new Error("refresh failed"), recoveryPreview(3)],
    sends: [recoveryHttpError(CONFLICT_CODE), recoveryReceipt()] })
  await view.click("확인 후 발송")
  assert.equal(view.calls.preview.length, 2)
  assert.match(view.text(), /미리보기를 불러오지 못했습니다/)
  assert.equal(view.button("확인 후 발송").disabled, true)
  await view.flush()
  assert.equal(view.calls.preview.length, 2, "A failed replacement must not create an automatic retry loop")
  await view.click("미리보기 다시 확인", 2)
  assert.equal(view.calls.preview.length, 3)
  assert.equal(view.calls.send.length, 1)
  await view.click("확인 후 발송")
  assert.equal(view.calls.send[1].body.previewId, recoveryPreview(3).previewId)
  assert.notEqual(view.calls.send[1].body.requestKey, view.calls.send[0].body.requestKey)
})

for (const [name, failure] of [
  ["network rejection", new Error("Failed to fetch")],
  ["prefixed conflict text", recoveryHttpError(`prefix:${CONFLICT_CODE}`)],
  ["suffixed conflict text", recoveryHttpError(`${CONFLICT_CODE}:suffix`)],
  ["non-Error conflict string", { throws: CONFLICT_CODE }],
]) {
  test(`${name} does not refresh or rotate the original confirmation key`, async t => {
    const view = await mountRecoveryDialog(t, { previews: [recoveryPreview()], sends: [failure, recoveryReceipt()] })
    await view.click("확인 후 발송")
    assert.equal(view.calls.preview.length, 1)
    assert.equal(view.calls.send.length, 1)
    await view.click("확인 후 발송")
    assert.equal(view.calls.preview.length, 1)
    assert.equal(view.calls.send.length, 2)
    assert.deepEqual(view.calls.send[1].body, view.calls.send[0].body, "Uncertain send outcome retains receipt and idempotency key")
  })
}

test("target change aborts a manual retry and ignores its late preview", async t => {
  const retry = controlledPromise()
  const view = await mountRecoveryDialog(t, { previews: [new Error("first failed"), retry.promise, recoveryPreview(3)] })
  await view.click("미리보기 다시 확인")
  await view.render({ target: { messageKind: "observation_booking", sourceId: RECOVERY_SOURCE_B } })
  assert.equal(view.calls.preview[1].signal.aborted, true)
  assert.equal(view.calls.preview.length, 3)
  await view.resolve(retry, recoveryPreview(2))
  assert.match(view.text(), /합성 학생 3/)
  assert.doesNotMatch(view.text(), /합성 학생 2/)
  assert.equal(view.calls.send.length, 0)
})

test("closing and reopening invalidates a conflict refresh response and its prior confirmation", async t => {
  const conflictRefresh = controlledPromise()
  const view = await mountRecoveryDialog(t, { previews: [recoveryPreview(), conflictRefresh.promise, recoveryPreview(3)],
    sends: [recoveryHttpError(CONFLICT_CODE)] })
  await view.click("확인 후 발송")
  assert.equal(view.calls.preview.length, 2)
  await view.click("돌아가기")
  assert.equal(view.calls.preview[1].signal.aborted, true)
  await view.render({ open: true })
  assert.equal(view.calls.preview.length, 3)
  await view.resolve(conflictRefresh, recoveryPreview(2))
  assert.match(view.text(), /합성 학생 3/)
  assert.doesNotMatch(view.text(), /합성 학생 2/)
  assert.equal(view.calls.send.length, 1)
})

test("a stale send conflict after a target change cannot refresh the new target", async t => {
  const oldSend = controlledPromise()
  const view = await mountRecoveryDialog(t, { previews: [recoveryPreview(), recoveryPreview(2)], sends: [oldSend.promise] })
  await view.click("확인 후 발송")
  await view.render({ target: { messageKind: "observation_booking", sourceId: RECOVERY_SOURCE_B } })
  await view.resolve(oldSend, recoveryHttpError(CONFLICT_CODE))
  assert.equal(view.calls.preview.length, 2)
  assert.equal(view.calls.send.length, 1)
  assert.match(view.text(), /합성 학생 2/)
  assert.doesNotMatch(view.text(), /등록 수업 정보가 변경/)
})

test("an uncertain send stays on its original receipt when that preview later expires", async t => {
  const view = await mountRecoveryDialog(t, { previews: [recoveryPreview()], sends: [new Error("uncertain network outcome")] })
  await view.click("확인 후 발송")
  assert.equal(view.calls.send.length, 1)
  await view.advance(60_001)
  assert.equal(view.button("미리보기 다시 확인"), undefined, "Expiry must not rotate a receipt after an uncertain send")
  assert.equal(view.button("확인 후 발송").disabled, true)
  assert.equal(view.calls.preview.length, 1)
  assert.equal(view.calls.send.length, 1)
})

test("a later exact conflict cannot erase an earlier uncertain send with the same request key", async t => {
  const view = await mountRecoveryDialog(t, { previews: [recoveryPreview()],
    sends: [new Error("uncertain network outcome"), recoveryHttpError(CONFLICT_CODE), recoveryReceipt()] })
  await view.click("확인 후 발송")
  await view.click("확인 후 발송")
  assert.equal(view.calls.preview.length, 1, "An earlier request may already have executed")
  assert.equal(view.calls.send.length, 2)
  assert.deepEqual(view.calls.send[1].body, view.calls.send[0].body)
  assert.equal(view.button("미리보기 다시 확인"), undefined)
  await view.click("확인 후 발송")
  assert.equal(view.calls.send.length, 3)
  assert.deepEqual(view.calls.send[2].body, view.calls.send[0].body)
  assert.equal(view.calls.preview.length, 1)
})

test("an invalid receipt expiry is explained and requires manual preview replacement", async t => {
  const view = await mountRecoveryDialog(t, { previews: [recoveryPreview(1, { expiresAt: "not-a-date" }), recoveryPreview(2)] })
  assert.match(view.text(), /유효 시간을 확인할 수 없습니다/)
  assert.doesNotMatch(view.text(), /Invalid Date|not-a-date/)
  assert.equal(view.button("확인 후 발송").disabled, true)
  assert.equal(view.calls.preview.length, 1)
  await view.click("미리보기 다시 확인")
  assert.equal(view.calls.preview.length, 2)
  assert.equal(view.button("확인 후 발송").disabled, false)
  assert.equal(view.calls.send.length, 0)
})

test("a readiness-blocked preview without a receipt is not described as expired", async t => {
  const preview = recoveryPreview(1, { previewId: null, expiresAt: null })
  preview.readiness = { ...preview.readiness, sendAllowed: false, activationMode: "off", blockers: ["activation_off"] }
  const view = await mountRecoveryDialog(t, { previews: [preview] })
  assert.match(view.text(), /발송이 꺼져 있습니다/)
  assert.doesNotMatch(view.text(), /만료|유효 시간을 확인할 수 없습니다/)
  assert.equal(view.button("미리보기 다시 확인"), undefined)
  assert.equal(view.button("확인 후 발송").disabled, true)
  assert.equal(view.calls.preview.length, 1)
  assert.equal(view.calls.send.length, 0)
})

test("manual retry keeps a focused loading action disabled and returns focus to the preview title", async t => {
  const pending = controlledPromise()
  const view = await mountRecoveryDialog(t, { previews: [new Error("load failed"), pending.promise] })
  const retry = view.button("미리보기 다시 확인")
  assert.ok(retry)
  retry.focus()
  await view.click("미리보기 다시 확인", 2)
  assert.equal(view.calls.preview.length, 2)
  assert.equal(view.button("미리보기 다시 확인").disabled, true)
  await view.resolve(pending, recoveryPreview(2))
  assert.equal(view.dom.window.document.activeElement.textContent, "알림톡 미리보기")
  assert.notEqual(view.dom.window.document.activeElement, view.button("확인 후 발송"))
  assert.equal(view.calls.send.length, 0)
})

test("same-target reopen resets controlled administrator recovery selections before any new action", async t => {
  const latestMessage = { ...recoveryReceipt({ currentStatus: "unknown", canCheck: true }) }
  delete latestMessage.ok
  delete latestMessage.idempotent
  const view = await mountRecoveryDialog(t, { previews: [recoveryPreview(1, { latestMessage }), recoveryPreview(2, { latestMessage })],
    props: { viewerRole: "admin" } })
  const selects = [...view.dom.window.document.querySelectorAll("select")]
  const inputs = [...view.dom.window.document.querySelectorAll("input")]
  const inputValues = ["합성 복구 사유", "200", "합성 provider 확인", "2026-10-29T17:00", "synthetic-message", "synthetic-group"]
  assert.equal(selects.length, 2)
  assert.equal(inputs.length, inputValues.length)
  const setValue = Object.getOwnPropertyDescriptor(view.dom.window.HTMLInputElement.prototype, "value").set
  await act(async () => {
    inputs.forEach((input, index) => {
      setValue.call(input, inputValues[index])
      input.dispatchEvent(new view.dom.window.Event("input", { bubbles: true }))
      input.dispatchEvent(new view.dom.window.Event("change", { bubbles: true }))
    })
    selects[0].value = "failed_hold"
    selects[0].dispatchEvent(new view.dom.window.Event("change", { bubbles: true }))
    selects[1].value = "true"
    selects[1].dispatchEvent(new view.dom.window.Event("change", { bubbles: true }))
  })
  await view.render({ canReleasePreSend: true })
  assert.deepEqual([...view.dom.window.document.querySelectorAll("select")].map(node => node.value), ["failed_hold", "true"], "Exercise actual controlled React state before resetting")
  assert.deepEqual([...view.dom.window.document.querySelectorAll("input")].map(node => node.value), inputValues, "Native input events must update actual controlled React state")
  assert.equal(view.button("상태 확정").disabled, false, "All administrator evidence is actually populated before reset; never submit it")
  await view.click("돌아가기")
  await view.render({ open: true })
  assert.deepEqual([...view.dom.window.document.querySelectorAll("select")].map(node => node.value), ["accepted", ""])
  assert.equal([...view.dom.window.document.querySelectorAll("input")].every(node => node.value === ""), true)
  assert.equal(view.button("상태 확정").disabled, true)
  assert.equal(view.calls.preview.length, 2)
  assert.equal(view.calls.send.length, 0)
})

test("HTTP 502 unknown-after-marker receipt preserves its idempotency key even after a later exact conflict", async t => {
  // Match the existing route's unknownAfterMarker public SendResult, which has
  // no error code even though requestJson rejects the non-2xx HTTP response.
  const unknownAfterMarker = recoveryReceipt({ ok: false, currentStatus: "unknown", canCheck: false })
  assert.equal(Object.hasOwn(unknownAfterMarker, "code"), false)
  const view = await mountRecoveryDialog(t, { previews: [recoveryPreview()],
    sends: [Response.json(unknownAfterMarker, { status: 502 }), recoveryHttpError(CONFLICT_CODE), recoveryReceipt()] })
  await view.click("확인 후 발송")
  assert.match(view.text(), /발송 요청을 처리하지 못했습니다/)
  assert.equal(view.calls.preview.length, 1)
  await view.click("확인 후 발송")
  assert.equal(view.calls.preview.length, 1)
  assert.deepEqual(view.calls.send[1].body, view.calls.send[0].body)
  await view.click("확인 후 발송")
  assert.deepEqual(view.calls.send[2].body, view.calls.send[0].body)
  assert.equal(view.calls.preview.length, 1)
  assert.equal(view.calls.send.length, 3)
})

for (const status of ["pending", "accepted", "unknown", "failed_hold", "duplicate_locked"]) {
  test(`an expired preview with ${status} cannot offer a new-preview retry`, async t => {
    const preview = recoveryPreview(1, { expiresAt: new Date(RECOVERY_NOW - 1).toISOString() })
    if (status === "duplicate_locked") {
      preview.readiness = { ...preview.readiness, sendAllowed: false, blockers: ["duplicate_locked"] }
    } else {
      const latestMessage = recoveryReceipt({ currentStatus: status, canCheck: ["pending", "unknown"].includes(status) })
      delete latestMessage.ok
      delete latestMessage.idempotent
      preview.latestMessage = latestMessage
    }
    const view = await mountRecoveryDialog(t, { previews: [preview] })
    assert.equal(view.button("미리보기 다시 확인"), undefined)
    assert.doesNotMatch(view.text(), /미리보기가 만료되었습니다/)
    assert.equal(view.calls.preview.length, 1)
    assert.equal(view.calls.send.length, 0)
  })
}

test("manual retry restores title focus after Radix moves the disabled action focus to dialog content", async t => {
  const pending = controlledPromise()
  const view = await mountRecoveryDialog(t, { previews: [new Error("load failed"), pending.promise] })
  view.button("미리보기 다시 확인").focus()
  await view.click("미리보기 다시 확인")
  assert.equal(view.button("미리보기 다시 확인").disabled, true)
  const content = view.dom.window.document.querySelector('[data-slot="dialog-content"]')
  // Real Radix browser evidence shows this focus fallback when the retry button
  // becomes disabled. The mounted harness reproduces that observed DOM state.
  content.focus()
  assert.equal(view.dom.window.document.activeElement === content, true)
  await view.resolve(pending, recoveryPreview(2))
  const title = view.dom.window.document.querySelector('[data-slot="dialog-title"]')
  assert.equal(title.tagName, "H2")
  assert.equal(view.dom.window.document.activeElement === title, true, "The completed retry must focus the preview title after dialog-content fallback")
  assert.notEqual(view.dom.window.document.activeElement, view.button("확인 후 발송"))
  assert.equal(view.calls.preview.length, 2)
  assert.equal(view.calls.send.length, 0)
})

for (const destination of ["another dialog button", "an outside input"]) {
  test(`manual retry preserves focus explicitly moved to ${destination}`, async t => {
    const pending = controlledPromise()
    const view = await mountRecoveryDialog(t, { previews: [new Error("load failed"), pending.promise] })
    view.button("미리보기 다시 확인").focus()
    await view.click("미리보기 다시 확인")
    view.dom.window.document.querySelector('[data-slot="dialog-content"]').focus()
    const nextFocus = destination === "another dialog button"
      ? view.button("돌아가기") : view.dom.window.document.createElement("input")
    if (destination === "an outside input") {
      nextFocus.setAttribute("aria-label", "합성 외부 입력")
      view.dom.window.document.body.append(nextFocus)
    }
    nextFocus.focus()
    assert.equal(view.dom.window.document.activeElement === nextFocus, true)
    await view.resolve(pending, recoveryPreview(2))
    assert.equal(view.dom.window.document.activeElement === nextFocus, true, "A completed preview must not steal an explicitly moved focus")
    assert.equal(view.calls.preview.length, 2)
    assert.equal(view.calls.send.length, 0)
  })
}
