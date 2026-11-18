import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

import { act, createElement, forwardRef } from "react"
import { createRoot } from "react-dom/client"
import ts from "typescript"
import { createRegistrationCustomerMessageClient } from "../src/features/tasks/registration-customer-message-service.ts"
import { formatRegistrationMessageTimestamp } from "../src/features/tasks/registration-customer-message-labels.ts"
import { renderRegistrationCustomerMessage } from "../src/features/tasks/server/registration-customer-message-catalog.ts"

const require = createRequire(import.meta.url)
const { JSDOM } = require("jsdom")

const dialogUrl = new URL("../src/features/tasks/registration-alimtalk-preview-dialog.tsx", import.meta.url)
const sharedDialogUrl = new URL("../src/components/ui/dialog.tsx", import.meta.url)
const fixturesUrl = new URL("../src/features/tasks/registration-track-fixtures.ts", import.meta.url)

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
  const Wrapper = ({ children, ...props }) => {
    delete props.overlayClassName
    delete props.showCloseButton
    delete props.onEscapeKeyDown
    return createElement("div", props, children)
  }
  const runtimeModule = { exports: {} }
  const localModules = new Map([
    ["@/components/ui/button", { Button }],
    ["@/components/ui/dialog", {
      Dialog,
      DialogClose: ({ children }) => children,
      DialogContent: Wrapper,
      DialogDescription: Wrapper,
      DialogFooter: Wrapper,
      DialogHeader: Wrapper,
      DialogTitle: Wrapper,
    }],
    ["./registration-customer-message-errors", {
      getRegistrationCustomerMessageErrorMessage: (_error, fallback) => fallback,
      getRegistrationCustomerMessageReadinessMessage: () => "발송 준비 상태를 확인해 주세요.",
    }],
    ["./registration-customer-message-labels", { formatRegistrationMessageTimestamp }],
  ])
  // The baseline has no scope helper. Load the actual helper when the product
  // introduces it; a missing UI assertion, not a synthetic helper, establishes RED.
  const subjectScopeUrl = new URL("../src/features/tasks/registration-preview-subject-scope.ts", import.meta.url)
  if (await sourceOrEmpty(subjectScopeUrl)) {
    localModules.set("./registration-preview-subject-scope", await import(subjectScopeUrl.href))
  }
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
    root = createRoot(dom.window.document.getElementById("root"))
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

const SCOPE_TASK = "d6400000-0000-4000-8000-000000000010"
const SCOPE_OTHER_TASK = "d6400000-0000-4000-8000-000000000011"
const SCOPE_SOURCE = "d6400000-0000-4000-8000-000000000012"
const SCOPE_OTHER_SOURCE = "d6400000-0000-4000-8000-000000000013"
const SCOPE_TRACKS = Object.freeze([
  Object.freeze({ id: "d6400000-0000-4000-8000-000000000014", taskId: SCOPE_TASK, subject: "영어" }),
  Object.freeze({ id: "d6400000-0000-4000-8000-000000000015", taskId: SCOPE_TASK, subject: "수학" }),
])
const SCOPE_LABEL = "이번 미리보기 대상 과목"
const SCOPE_EXCLUDED = "현재 불러온 등록 과목 중 미포함"
const SCOPE_UNKNOWN = "현재 불러온 등록 과목과 비교할 수 없습니다."
const SCOPE_CAVEAT = "이번 미리보기의 미포함 여부는 과거 발송 여부를 뜻하지 않습니다."

function scopeContext(target, tracks = SCOPE_TRACKS, taskId = SCOPE_TASK) {
  return { taskId, target: { ...target }, tracks: tracks.map(track => ({ ...track })) }
}

function scopePreview(messageKind = "level_test_booking", subjects = ["영어"]) {
  const rendered = renderRegistrationCustomerMessage({
    kind: messageKind,
    facts: {
      studentName: "합성 학생",
      subjects,
      scheduledAt: "2099-08-17T09:00:00.000Z",
      place: "본관",
      appointmentKind: messageKind === "level_test_booking" ? "level_test" : "visit_consultation",
      ...(messageKind === "observation_booking" ? {
        campus: "본관", className: "합성 영어반", teacherName: "합성 선생님",
      } : {}),
    },
  })
  return {
    ...observationPreview(SCOPE_SOURCE),
    messageKind,
    studentName: "합성 학생",
    facts: rendered.facts,
    body: rendered.body,
    buttons: rendered.buttons.map(button => ({ name: button.name, type: button.type, host: new URL(button.linkMobile).host })),
  }
}

async function mountSubjectScope(t, { messageKind = "level_test_booking", response, context, previewResponse } = {}) {
  const Dialog = await loadMountedDialog()
  const dom = new JSDOM('<!doctype html><html><body><button id="opener">열기</button><div id="scope-root"></div></body></html>')
  const descriptors = new Map(["window", "document", "navigator", "crypto", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, crypto: dom.window.crypto, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const calls = []
  const client = createRegistrationCustomerMessageClient({
    getAccessToken: async () => "synthetic-scope-token",
    fetch: async (url, init) => {
      const body = JSON.parse(init.body)
      calls.push({ url, method: init.method, body, signal: init.signal })
      if (url === "/api/solapi/registration/preview" || url === "/api/solapi/registration/bundles/preview") {
        const payload = previewResponse ? await previewResponse(body, init.signal) : response ?? scopePreview(messageKind)
        return { ok: true, json: async () => payload }
      }
      if (url === "/api/solapi/registration/send") {
        return { ok: true, json: async () => ({
          ok: true, messageId: "d6400000-0000-4000-8000-000000000016", messageKind,
          currentStatus: "accepted", recipientLast4: "5678", confirmedByName: "합성 관리자",
          confirmedAt: "2099-08-12T00:01:00.000Z", updatedAt: "2099-08-12T00:01:00.000Z",
          canCheck: false, idempotent: false,
        }) }
      }
      assert.fail(`Unexpected synthetic scope request: ${url}`)
    },
  })
  const root = createRoot(dom.window.document.getElementById("scope-root"))
  const target = { messageKind, sourceId: SCOPE_SOURCE }
  let props = { open: true, onOpenChange: () => undefined, target, client, viewerRole: "staff", caseSubjects: context === undefined ? scopeContext(target) : context }
  const view = {
    document: dom.window.document, calls,
    async render(patch = {}) {
      props = { ...props, ...patch }
      await act(async () => { root.render(createElement(Dialog, props)); await new Promise(resolve => setImmediate(resolve)) })
    },
    text: () => dom.window.document.body.textContent,
    row(label) {
      const dt = [...dom.window.document.querySelectorAll("dt")].find(node => node.textContent.replace(/\s*·\s*$/u, "").trim() === label)
      return dt?.parentElement.querySelector("dd")?.textContent ?? null
    },
    confirm: () => [...dom.window.document.querySelectorAll("button")].find(button => button.textContent === "확인 후 발송"),
  }
  t.after(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  await view.render()
  return view
}

for (const messageKind of ["level_test_booking", "visit_consultation_booking", "observation_booking"]) {
  test(`subject scope: ${messageKind} distinguishes the actual preview from current saved subjects without blocking confirmation`, async t => {
    const response = scopePreview(messageKind)
    const view = await mountSubjectScope(t, { messageKind, response })
    assert.equal(view.row(SCOPE_LABEL), response.facts.subjectLabel)
    assert.equal(view.row(SCOPE_EXCLUDED), "수학")
    assert.equal(view.text().includes(SCOPE_CAVEAT), true)
    assert.equal(view.text().includes(SCOPE_UNKNOWN), false)
    assert.doesNotMatch(view.text(), /미발송|모두 발송|전체 포함/u)
    assert.equal(view.confirm()?.disabled, false)
    assert.deepEqual(view.calls.map(({ url, body }) => ({ url, body })), [{
      url: "/api/solapi/registration/preview", body: { messageKind, sourceId: SCOPE_SOURCE },
    }])
    await act(async () => { view.confirm().click(); view.confirm().click(); await new Promise(resolve => setImmediate(resolve)) })
    const sends = view.calls.filter(call => call.url.endsWith("/send"))
    assert.equal(sends.length, 1)
    assert.deepEqual(Object.keys(sends[0].body).sort(), ["previewId", "requestKey"])
    assert.equal(sends[0].body.previewId, response.previewId)
    assert.equal(typeof sends[0].body.requestKey, "string")
    assert.equal(view.calls.filter(call => call.url.endsWith("/preview")).length, 1)
  })
}

test("subject scope: canonical complete subjects and reordered immutable context do not invent exclusions or refetch", async t => {
  const target = { messageKind: "level_test_booking", sourceId: SCOPE_SOURCE }
  const response = scopePreview(target.messageKind, ["수학", "영어", "영어"])
  assert.equal(response.facts.subjectLabel, "영어 · 수학", "the actual producer removes duplicate subject inputs")
  const view = await mountSubjectScope(t, { response })
  assert.equal(view.row(SCOPE_LABEL), "영어 · 수학")
  assert.equal(view.row(SCOPE_EXCLUDED), null)
  assert.equal(view.text().includes(SCOPE_UNKNOWN), false)
  assert.equal(view.text().includes(SCOPE_CAVEAT), true)
  await view.render({ caseSubjects: scopeContext(target, [...SCOPE_TRACKS].reverse()) })
  assert.equal(view.text().includes(SCOPE_UNKNOWN), false)
  assert.equal(view.calls.length, 1)
  assert.deepEqual(SCOPE_TRACKS.map(track => track.subject), ["영어", "수학"])
  assert.equal(view.confirm().disabled, false)
})

const unknownScopeCases = [
  ["missing current context", { context: null }],
  ["empty current tracks", { context: scopeContext({ messageKind: "level_test_booking", sourceId: SCOPE_SOURCE }, []) }],
  ["duplicate saved subject labels", { context: scopeContext({ messageKind: "level_test_booking", sourceId: SCOPE_SOURCE }, [...SCOPE_TRACKS, { ...SCOPE_TRACKS[1], id: SCOPE_OTHER_SOURCE }]) }],
  ["duplicate track identities", { context: scopeContext({ messageKind: "level_test_booking", sourceId: SCOPE_SOURCE }, [SCOPE_TRACKS[0], { ...SCOPE_TRACKS[1], id: SCOPE_TRACKS[0].id }]) }],
  ["unknown current subject", { context: scopeContext({ messageKind: "level_test_booking", sourceId: SCOPE_SOURCE }, [{ ...SCOPE_TRACKS[0], subject: "기타" }, SCOPE_TRACKS[1]]) }],
  ["foreign case track", { context: scopeContext({ messageKind: "level_test_booking", sourceId: SCOPE_SOURCE }, [{ ...SCOPE_TRACKS[0], taskId: SCOPE_OTHER_TASK }, SCOPE_TRACKS[1]]) }],
  ["outer case identity mismatch", { context: scopeContext({ messageKind: "level_test_booking", sourceId: SCOPE_SOURCE }, SCOPE_TRACKS, SCOPE_OTHER_TASK) }],
  ["context target mismatch", { context: scopeContext({ messageKind: "level_test_booking", sourceId: SCOPE_OTHER_SOURCE }) }],
  ["context kind mismatch", { context: scopeContext({ messageKind: "visit_consultation_booking", sourceId: SCOPE_SOURCE }) }],
  ["comma summary", { label: "영어, 수학" }],
  ["custom summary", { label: "영어 외 1과목" }],
  ["empty summary", { label: "" }],
  ["partially recognized summary", { label: "영어 · 기타" }],
  ["duplicate preview labels", { label: "영어 · 영어" }],
  ["noncanonical separator", { label: "영어·수학" }],
  ["preview subject absent from current tracks", { label: "과학" }],
  ["response kind mismatch", { responseKind: "visit_consultation_booking" }],
]
for (const [name, input] of unknownScopeCases) {
  test(`subject scope: ${name} stays unknown without guessing from body or blocking ready confirmation`, async t => {
    const response = scopePreview()
    if (Object.hasOwn(input, "label")) response.facts = { ...response.facts, subjectLabel: input.label }
    if (input.responseKind) response.messageKind = input.responseKind
    response.body = "합성 본문 영어 · 수학 — 이 본문에서 과목을 추측하지 않습니다."
    const view = await mountSubjectScope(t, { response, ...(Object.hasOwn(input, "context") ? { context: input.context } : {}) })
    // A response for a different kind cannot establish the requested preview's
    // subjects; this is an unknown comparison, not another loading state.
    assert.equal(view.row(SCOPE_LABEL), input.responseKind ? "확인할 수 없음" : response.facts.subjectLabel || "확인할 수 없음")
    assert.equal(view.row(SCOPE_EXCLUDED), null)
    assert.equal(view.text().includes(SCOPE_UNKNOWN), true)
    assert.equal(view.text().includes(SCOPE_CAVEAT), true)
    assert.equal(view.confirm()?.disabled, false)
    assert.equal(view.calls.length, 1)
    assert.deepEqual(view.calls[0].body, { messageKind: "level_test_booking", sourceId: SCOPE_SOURCE })
    if (name === "missing current context") {
      await act(async () => { view.confirm().click(); await new Promise(resolve => setImmediate(resolve)) })
      assert.equal(view.calls.filter(call => call.url.endsWith("/send")).length, 1)
    }
  })
}

for (const [name, changedTracks] of [
  ["add", [...SCOPE_TRACKS, { id: "d6400000-0000-4000-8000-000000000017", taskId: SCOPE_TASK, subject: "과학" }]],
  ["remove", SCOPE_TRACKS.slice(0, 1)],
  ["replace identity with same labels", SCOPE_TRACKS.map(track => track.subject === "수학" ? { ...track, id: SCOPE_OTHER_SOURCE } : track)],
]) {
  test(`subject scope: saved track ${name} invalidates comparison without reloading preview or changing send DTO`, async t => {
    const view = await mountSubjectScope(t)
    assert.equal(view.row(SCOPE_EXCLUDED), "수학")
    await view.render({ caseSubjects: scopeContext({ messageKind: "level_test_booking", sourceId: SCOPE_SOURCE }, changedTracks) })
    assert.equal(view.row(SCOPE_LABEL), "영어")
    assert.equal(view.row(SCOPE_EXCLUDED), null)
    assert.equal(view.text().includes(SCOPE_UNKNOWN), true)
    assert.equal(view.calls.length, 1)
    assert.equal(view.confirm().disabled, false)
  })
}

test("subject scope: tracks changing during loading cannot be paired with the older request snapshot", async t => {
  const pending = controlledPromise()
  const view = await mountSubjectScope(t, { previewResponse: async () => pending.promise })
  assert.equal(view.row(SCOPE_LABEL), null)
  assert.equal(view.row(SCOPE_EXCLUDED), null)
  assert.equal(view.confirm().disabled, true)
  await view.render({ caseSubjects: scopeContext({ messageKind: "level_test_booking", sourceId: SCOPE_SOURCE }, SCOPE_TRACKS.slice(0, 1)) })
  await act(async () => { pending.resolve(scopePreview()); await pending.promise })
  assert.equal(view.row(SCOPE_LABEL), "영어")
  assert.equal(view.row(SCOPE_EXCLUDED), null)
  assert.equal(view.text().includes(SCOPE_UNKNOWN), true)
  assert.equal(view.calls.length, 1)
})

test("subject scope: late previous target responses cannot overwrite the next case comparison", async t => {
  const first = controlledPromise()
  const second = controlledPromise()
  const view = await mountSubjectScope(t, { previewResponse: async target => target.sourceId === SCOPE_SOURCE ? first.promise : second.promise })
  const target = { messageKind: "level_test_booking", sourceId: SCOPE_OTHER_SOURCE }
  const tracks = [{ ...SCOPE_TRACKS[1], taskId: SCOPE_OTHER_TASK }]
  await view.render({ target, caseSubjects: scopeContext(target, tracks, SCOPE_OTHER_TASK) })
  assert.equal(view.row(SCOPE_LABEL), null)
  assert.equal(view.row(SCOPE_EXCLUDED), null)
  await act(async () => { second.resolve(scopePreview("level_test_booking", ["수학"])); await second.promise })
  assert.equal(view.row(SCOPE_LABEL), "수학")
  assert.equal(view.row(SCOPE_EXCLUDED), null)
  assert.equal(view.text().includes(SCOPE_UNKNOWN), false)
  await act(async () => { first.resolve(scopePreview()); await first.promise })
  assert.equal(view.row(SCOPE_LABEL), "수학")
  assert.equal(view.text().includes(SCOPE_UNKNOWN), false)
  assert.equal(view.calls[0].signal.aborted, true)
  assert.deepEqual(view.calls.map(call => call.body), [
    { messageKind: "level_test_booking", sourceId: SCOPE_SOURCE }, target,
  ])
})

test("subject scope: closing then reopening starts a fresh comparison for the current saved tracks", async t => {
  const view = await mountSubjectScope(t)
  assert.equal(view.row(SCOPE_EXCLUDED), "수학")
  await view.render({ open: false })
  assert.equal(view.row(SCOPE_LABEL), null)
  await view.render({ open: true, caseSubjects: scopeContext({ messageKind: "level_test_booking", sourceId: SCOPE_SOURCE }, SCOPE_TRACKS.slice(0, 1)) })
  assert.equal(view.row(SCOPE_LABEL), "영어")
  assert.equal(view.row(SCOPE_EXCLUDED), null)
  assert.equal(view.text().includes(SCOPE_UNKNOWN), false)
  assert.equal(view.calls.length, 2)
})

for (const mode of ["expired", "duplicate_locked", "pending", "accepted", "unknown", "failed_hold", "readiness blocked"]) {
  test(`subject scope: ${mode} retains the existing confirmation guard`, async t => {
    const response = scopePreview()
    if (mode === "expired") response.expiresAt = "2000-01-01T00:00:00.000Z"
    else if (mode === "duplicate_locked") response.readiness = { ...response.readiness, blockers: ["duplicate_locked"] }
    else if (mode === "readiness blocked") response.readiness = { ...response.readiness, sendAllowed: false, blockers: ["activation_off"] }
    else response.latestMessage = {
      messageId: "d6400000-0000-4000-8000-000000000016", messageKind: response.messageKind,
      currentStatus: mode, confirmedByName: "합성 관리자", confirmedAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z", canCheck: false,
    }
    const view = await mountSubjectScope(t, { response })
    assert.equal(view.row(SCOPE_LABEL), "영어")
    if (mode === "expired") {
      assert.equal(view.row(SCOPE_EXCLUDED), null)
      assert.equal(view.text().includes(SCOPE_UNKNOWN), true)
    } else assert.equal(view.row(SCOPE_EXCLUDED), "수학")
    const confirmation = view.confirm()
    assert.equal(!confirmation || confirmation.disabled, true)
    assert.equal(view.calls.filter(call => call.url.endsWith("/send")).length, 0)
    assert.equal(view.text().includes(SCOPE_CAVEAT), true)
    assert.doesNotMatch(view.text(), /미발송|모두 발송|전체 포함/u)
  })
}

for (const messageKind of ["waiting_notice", "admission_application", "appointment_reminder", "observation_reminder", "level_test_booking_bundle"]) {
  test(`subject scope: unsupported ${messageKind} keeps its existing presentation`, async t => {
    const response = { ...scopePreview(), messageKind }
    const view = await mountSubjectScope(t, { messageKind, response })
    assert.equal(view.row("대상"), "영어")
    assert.equal(view.row(SCOPE_LABEL), null)
    assert.equal(view.row(SCOPE_EXCLUDED), null)
    assert.equal(view.text().includes(SCOPE_CAVEAT), false)
    assert.equal(view.text().includes(SCOPE_UNKNOWN), false)
  })
}

test("subject scope: a next-target preview failure clears the preceding scope rather than claiming an empty preview", async t => {
  const view = await mountSubjectScope(t, { previewResponse: async target => {
    if (target.sourceId === SCOPE_OTHER_SOURCE) throw new Error("synthetic_preview_failure")
    return scopePreview()
  } })
  assert.equal(view.row(SCOPE_EXCLUDED), "수학")
  const target = { messageKind: "level_test_booking", sourceId: SCOPE_OTHER_SOURCE }
  await view.render({ target, caseSubjects: scopeContext(target) })
  assert.equal(view.row(SCOPE_LABEL), null)
  assert.equal(view.row(SCOPE_EXCLUDED), null)
  assert.match(view.document.querySelector('[role="alert"]').textContent, /미리보기를 불러오지 못했습니다/u)
  assert.equal(view.confirm().disabled, true)
  assert.equal(view.calls.filter(call => call.url.endsWith("/send")).length, 0)
})

test("subject scope: expiry timer removes a previously known comparison without making another request", async t => {
  const view = await mountSubjectScope(t, { previewResponse: async () => ({
    ...scopePreview(), expiresAt: new Date(Date.now() + 500).toISOString(),
  }) })
  assert.equal(view.row(SCOPE_EXCLUDED), "수학")
  assert.equal(view.confirm().disabled, false)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 550)) })
  assert.equal(view.row(SCOPE_LABEL), "영어")
  assert.equal(view.row(SCOPE_EXCLUDED), null)
  assert.equal(view.text().includes(SCOPE_UNKNOWN), true)
  assert.equal(view.confirm().disabled, true)
  assert.equal(view.calls.length, 1)
})
