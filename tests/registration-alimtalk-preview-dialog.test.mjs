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
import { createRegistrationCustomerMessageRouteHandlers } from "../src/features/tasks/server/registration-customer-message-route.ts"

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
  assert.match(source, /이번 미리보기 수신자/)
  assert.match(source, /최근 요청 수신자/)
  assert.match(source, /끝 4자리만 표시됩니다/)
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

const AUDIT_TASK = "d6400000-0000-4000-8000-000000000010"
const AUDIT_SOURCE = "d6400000-0000-4000-8000-000000000011"
const AUDIT_NEXT_SOURCE = "d6400000-0000-4000-8000-000000000012"
const AUDIT_MESSAGE = "d6400000-0000-4000-8000-000000000013"
const AUDIT_TIME = "2026-10-29T00:01:00.000Z"
const AUDIT_UPDATED_TIME = "2026-10-29T02:32:00.000Z"
const MASKED_RECIPIENT_COPY = "끝 4자리만 표시됩니다. 전체 연락처는 등록 정보에서 확인해 주세요."
const MISSING_HISTORY_COPY = "이전 요청의 상세 정보는 현재 미리보기에서 확인할 수 없습니다."

function auditHistory(overrides = {}) {
  return {
    messageId: AUDIT_MESSAGE, messageKind: "waiting_notice", currentStatus: "accepted",
    confirmedByName: "합성 담당자", confirmedAt: AUDIT_TIME, updatedAt: AUDIT_UPDATED_TIME,
    recipientLast4: "1234", canCheck: false, ...overrides,
  }
}

function auditPreview(overrides = {}) {
  const original = observationPreview(AUDIT_SOURCE)
  return {
    ...original, messageKind: "waiting_notice", previewId: null, expiresAt: null,
    studentName: "합성 학생", facts: { subjectLabel: "영어", waitingKindLabel: "현재반 대기" },
    body: "합성 대기 신청 안내", recipientLast4: "5678",
    readiness: { ...original.readiness, sendAllowed: false, blockers: ["duplicate_locked"] },
    latestMessage: auditHistory(), ...overrides,
  }
}

function syntheticAuditPreviewRoute(payload) {
  const activity = { sourceReads: 0, historyReads: 0, previewInserts: 0, providerCalls: 0 }
  const handlers = createRegistrationCustomerMessageRouteHandlers({
    authenticate: async () => ({ actorProfileId: "d6400000-0000-4000-8000-000000000014", role: "staff" }),
    authorizeTask: async (_context, taskId) => taskId === AUDIT_TASK,
    resolveTaskId: async () => AUDIT_TASK,
    resolveSource: async ({ messageKind, sourceId }) => {
      activity.sourceReads++
      return { messageKind, sourceId, taskId: AUDIT_TASK, sourceRevision: 1,
        studentName: payload.studentName, recipientLast4: payload.recipientLast4,
        facts: payload.facts, body: payload.body, buttons: payload.buttons }
    },
    readPrivateSource: () => ({ readinessContract: {}, previewContract: {} }),
    getReadiness: async () => payload.readiness,
    listHistory: async () => { activity.historyReads++; return payload.latestMessage ? [payload.latestMessage] : [] },
    createPreview: async () => { activity.previewInserts++; assert.fail("Blocked preview must not create any receipt") },
    sendProvider: async () => { activity.providerCalls++; assert.fail("Provider calls are forbidden in the audit fixture") },
  })
  return { activity, preview: handlers.preview }
}

async function mountRecipientAudit(t, { payload = auditPreview(), route, previewResponse, sendResponse, viewerRole = "staff", sourceId = AUDIT_SOURCE } = {}) {
  const Dialog = await loadMountedDialog()
  const dom = new JSDOM('<!doctype html><html><body><button id="audit-opener">열기</button><div id="audit-root"></div></body></html>')
  const descriptors = new Map(["window", "document", "navigator", "crypto", "fetch", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  let unexpectedNetwork = 0
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    crypto: dom.window.crypto, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => { unexpectedNetwork++; assert.fail("Unexpected external network in recipient audit test") },
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  const calls = []
  const client = createRegistrationCustomerMessageClient({
    getAccessToken: async () => "synthetic-audit-token",
    fetch: async (url, init) => {
      const body = JSON.parse(init.body)
      calls.push({ url, body, method: init.method, signal: init.signal })
      if (url === "/api/solapi/registration/preview" || url === "/api/solapi/registration/bundles/preview") {
        if (route) return route.preview(new Request(`https://synthetic.invalid${url}`, init))
        return { ok: true, json: async () => previewResponse ? await previewResponse(body) : payload }
      }
      if (url === "/api/solapi/registration/send" && sendResponse) return { ok: true, json: async () => sendResponse(body) }
      assert.fail(`Unexpected synthetic audit action: ${url}`)
    },
  })
  const root = createRoot(dom.window.document.getElementById("audit-root"))
  let props
  const view = {
    document: dom.window.document, calls,
    async render(patch = {}) {
      props = { ...props, ...patch }
      await act(async () => { root.render(createElement(Dialog, props)); await new Promise(resolve => setImmediate(resolve)) })
    },
    text: () => dom.window.document.body.textContent,
    section: () => dom.window.document.querySelector('[aria-label="최근 발송 요청"]'),
    row(label, within = dom.window.document) {
      const dt = [...within.querySelectorAll("dt")].find(node => node.textContent.replace(/\s*·\s*$/u, "").trim() === label)
      return dt?.parentElement.querySelector("dd")?.textContent ?? null
    },
    confirm: () => [...dom.window.document.querySelectorAll("button")].find(button => button.textContent === "확인 후 발송"),
    acceptedStatus: () => [...dom.window.document.querySelectorAll('[role="status"]')].find(node => /SOLAPI 접수 완료/u.test(node.textContent)),
  }
  props = { open: true, onOpenChange: open => { props = { ...props, open }; root.render(createElement(Dialog, props)) },
    target: { messageKind: payload.messageKind, sourceId }, client, viewerRole,
    triggerRef: { current: dom.window.document.getElementById("audit-opener") } }
  t.after(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
    assert.equal(unexpectedNetwork, 0)
  })
  await view.render()
  return view
}

test("recipient audit: actual route and client keep the current preview suffix separate from the accepted receipt", async t => {
  const route = syntheticAuditPreviewRoute(auditPreview())
  const view = await mountRecipientAudit(t, { route })
  const accepted = view.acceptedStatus()
  assert.ok(accepted)
  assert.match(accepted.textContent, /끝 1234/u)
  assert.doesNotMatch(accepted.textContent, /5678/u)
  assert.equal(view.row("이번 미리보기 수신자"), "끝 5678")
  assert.ok(view.section())
  assert.equal(view.row("최근 요청 수신자", view.section()), "끝 1234")
  assert.equal(view.row("상태", view.section()), "SOLAPI 접수 완료")
  assert.equal(view.row("요청 시각", view.section()), formatRegistrationMessageTimestamp(AUDIT_TIME))
  assert.equal(view.section().textContent.includes(formatRegistrationMessageTimestamp(AUDIT_UPDATED_TIME)), false)
  assert.match(view.section().textContent, /발송 요청 · 합성 담당자/u)
  assert.equal(view.text().includes(MASKED_RECIPIENT_COPY), true)
  assert.equal(view.confirm(), undefined)
  assert.deepEqual(view.calls.map(({ url, body, method }) => ({ url, body, method })), [{
    url: "/api/solapi/registration/preview", method: "POST", body: { messageKind: "waiting_notice", sourceId: AUDIT_SOURCE },
  }])
  assert.deepEqual(route.activity, { sourceReads: 1, historyReads: 1, previewInserts: 0, providerCalls: 0 })
})

for (const [status, expectedLabel] of [
  ["pending", "발송 처리 중"], ["accepted", "SOLAPI 접수 완료"],
  ["unknown", "발송 결과 확인 필요"], ["failed_hold", "발송 실패 · 같은 내용 재발송 불가"],
]) {
  test(`recipient audit: ${status} keeps its own recipient, request time and existing send guard`, async t => {
    const payload = auditPreview({ latestMessage: auditHistory({ currentStatus: status }) })
    const view = await mountRecipientAudit(t, { payload })
    assert.ok(view.section())
    assert.equal(view.row("이번 미리보기 수신자"), "끝 5678")
    assert.equal(view.row("최근 요청 수신자", view.section()), "끝 1234")
    assert.equal(view.row("상태", view.section()), expectedLabel)
    assert.equal(view.row("요청 시각", view.section()), formatRegistrationMessageTimestamp(AUDIT_TIME))
    assert.match(view.section().textContent, /발송 요청 · 합성 담당자/u)
    assert.equal(view.section().textContent.includes(formatRegistrationMessageTimestamp(AUDIT_UPDATED_TIME)), false)
    assert.equal(view.text().includes(MASKED_RECIPIENT_COPY), true)
    assert.equal(view.text().includes(MISSING_HISTORY_COPY), false)
    assert.equal(view.confirm(), undefined)
    const locked = [...view.document.querySelectorAll("button")].find(button => button.textContent === "이미 발송 요청됨")
    if (status === "accepted") assert.ok([...view.document.querySelectorAll("button")].some(button => button.textContent === "전달 결과 확인"))
    else assert.equal(locked?.disabled, true)
    assert.deepEqual(view.calls.map(call => call.url), ["/api/solapi/registration/preview"])
    assert.doesNotMatch(view.section().textContent, /잠금 원인|동일 수신자|전체 번호 일치|전달 완료/u)
  })
}

for (const [name, value] of [
  ["missing", undefined], ["null", null], ["empty", ""], ["short", "123"],
  ["long", "12345"], ["non-digit", "12x4"], ["numeric", 1234],
  ["unicode digits", "１２３４"], ["surrounding whitespace", " 1234 "],
]) {
  test(`recipient audit: a ${name} historical suffix never falls back to the current preview number`, async t => {
    // Defensive consumer fixtures: the actual route rejects invalid/missing
    // operator history suffixes. Do not claim these malformed rows came from SQL.
    const latestMessage = auditHistory({ recipientLast4: value })
    if (value === undefined) delete latestMessage.recipientLast4
    const view = await mountRecipientAudit(t, { payload: auditPreview({ latestMessage }) })
    assert.equal(view.row("이번 미리보기 수신자"), "끝 5678")
    assert.ok(view.section())
    assert.equal(view.row("최근 요청 수신자", view.section()), "끝자리 확인 불가")
    assert.match(view.acceptedStatus().textContent, /끝자리 확인 불가/u)
    assert.doesNotMatch(view.acceptedStatus().textContent, /5678/u)
    assert.equal(view.calls.length, 1)
  })
}

test("recipient audit: a duplicate lock without history states the missing detail without inventing audit facts", async t => {
  const route = syntheticAuditPreviewRoute(auditPreview({ latestMessage: null }))
  const view = await mountRecipientAudit(t, { route })
  assert.equal(view.section(), null)
  assert.equal(view.text().includes(MISSING_HISTORY_COPY), true)
  assert.equal(view.row("요청 시각"), null)
  assert.equal(view.row("최근 요청 수신자"), null)
  assert.equal(view.row("이번 미리보기 수신자"), "끝 5678")
  assert.equal([...view.document.querySelectorAll("button")].find(button => button.textContent === "이미 발송 요청됨")?.disabled, true)
  assert.deepEqual(route.activity, { sourceReads: 1, historyReads: 1, previewInserts: 0, providerCalls: 0 })
  assert.equal(view.calls.length, 1)
})

test("recipient audit: ready preview without history adds no missing-history warning or confirmation blocker", async t => {
  const ready = observationPreview(AUDIT_SOURCE)
  const payload = auditPreview({ latestMessage: null, previewId: ready.previewId, expiresAt: ready.expiresAt, readiness: ready.readiness })
  const view = await mountRecipientAudit(t, { payload })
  assert.equal(view.section(), null)
  assert.equal(view.text().includes(MISSING_HISTORY_COPY), false)
  assert.equal(view.text().includes(MASKED_RECIPIENT_COPY), true)
  assert.equal(view.confirm().disabled, false)
  assert.equal(view.calls.length, 1)
})

test("recipient audit: malformed request time uses its formatter fallback and never substitutes updatedAt", async t => {
  const view = await mountRecipientAudit(t, { payload: auditPreview({ latestMessage: auditHistory({ confirmedAt: "invalid" }) }) })
  assert.equal(view.row("요청 시각", view.section()), "시간 확인 필요")
  assert.equal(view.section().textContent.includes(formatRegistrationMessageTimestamp(AUDIT_UPDATED_TIME)), false)
  assert.equal(view.calls.length, 1)
})

test("recipient audit: the actual route rejects an invalid history timestamp before the dialog can claim an audit date", async t => {
  const route = syntheticAuditPreviewRoute(auditPreview({ latestMessage: auditHistory({ confirmedAt: "invalid" }) }))
  const view = await mountRecipientAudit(t, { route })
  assert.equal(view.section(), null)
  assert.equal(view.row("이번 미리보기 수신자"), null)
  assert.match(view.document.querySelector('[role="alert"]').textContent, /미리보기를 불러오지 못했습니다/u)
  assert.equal(view.confirm().disabled, true)
  assert.equal(route.activity.previewInserts, 0)
  assert.equal(route.activity.providerCalls, 0)
  assert.equal(view.calls.length, 1)
})

test("recipient audit: automatic-request actor text is preserved without inventing a staff confirmer", async t => {
  const view = await mountRecipientAudit(t, { payload: auditPreview({ latestMessage: auditHistory({ confirmedByName: "자동 발송" }) }) })
  assert.match(view.section().textContent, /자동 발송/u)
  assert.doesNotMatch(view.section().textContent, /발송 요청 · 자동 발송/u)
  assert.equal(view.row("요청 시각", view.section()), formatRegistrationMessageTimestamp(AUDIT_TIME))
})

for (const [name, recipientLast4, expected] of [["valid", "9999", "끝 9999"], ["missing", undefined, "끝자리 확인 불가"]]) {
  test(`recipient audit: a ${name} new send-result suffix owns the accepted status and audit display`, async t => {
    const ready = observationPreview(AUDIT_SOURCE)
    const payload = auditPreview({ latestMessage: null, previewId: ready.previewId, expiresAt: ready.expiresAt, readiness: ready.readiness })
    // The missing suffix is a defensive consumer fixture, not output accepted
    // by the actual server's stricter send-result validator.
    const sendResult = { ...auditHistory({ recipientLast4, confirmedByName: "합성 신규 요청자", confirmedAt: "2026-10-29T03:04:00.000Z" }), ok: true, idempotent: false }
    if (recipientLast4 === undefined) delete sendResult.recipientLast4
    const view = await mountRecipientAudit(t, { payload, sendResponse: async () => sendResult })
    assert.equal(view.confirm().disabled, false)
    await act(async () => { view.confirm().click(); view.confirm().click(); await new Promise(resolve => setImmediate(resolve)) })
    assert.equal(view.row("이번 미리보기 수신자"), "끝 5678")
    assert.equal(view.row("최근 요청 수신자", view.section()), expected)
    assert.equal(view.acceptedStatus().textContent.includes(expected), true)
    assert.doesNotMatch(view.acceptedStatus().textContent, /5678/u)
    assert.match(view.section().textContent, /발송 요청 · 합성 신규 요청자/u)
    assert.equal(view.row("요청 시각", view.section()), formatRegistrationMessageTimestamp(sendResult.confirmedAt))
    const sends = view.calls.filter(call => call.url.endsWith("/send"))
    assert.equal(sends.length, 1)
    assert.deepEqual(Object.keys(sends[0].body).sort(), ["previewId", "requestKey"])
    assert.equal(sends[0].body.previewId, payload.previewId)
    assert.equal(typeof sends[0].body.requestKey, "string")
    assert.equal(view.calls.filter(call => call.url.endsWith("/preview")).length, 1)
  })
}

test("recipient audit: late old-target history never replaces the next preview's own audit receipt", async t => {
  const first = controlledPromise()
  const second = controlledPromise()
  const view = await mountRecipientAudit(t, { previewResponse: async target => target.sourceId === AUDIT_SOURCE ? first.promise : second.promise })
  assert.equal(view.section(), null)
  await view.render({ target: { messageKind: "waiting_notice", sourceId: AUDIT_NEXT_SOURCE } })
  await act(async () => {
    second.resolve(auditPreview({ recipientLast4: "8888", latestMessage: auditHistory({ recipientLast4: "7777", confirmedByName: "합성 다음 요청자" }) }))
    await second.promise
  })
  assert.equal(view.row("이번 미리보기 수신자"), "끝 8888")
  assert.equal(view.row("최근 요청 수신자", view.section()), "끝 7777")
  await act(async () => { first.resolve(auditPreview()); await first.promise })
  assert.equal(view.row("이번 미리보기 수신자"), "끝 8888")
  assert.equal(view.row("최근 요청 수신자", view.section()), "끝 7777")
  assert.doesNotMatch(view.acceptedStatus().textContent, /1234|5678/u)
  assert.equal(view.calls[0].signal.aborted, true)
  assert.deepEqual(view.calls.map(call => call.body), [
    { messageKind: "waiting_notice", sourceId: AUDIT_SOURCE },
    { messageKind: "waiting_notice", sourceId: AUDIT_NEXT_SOURCE },
  ])
})

test("recipient audit: closing and reopening clears the prior audit while the new request is pending", async t => {
  const pending = controlledPromise()
  let previews = 0
  const view = await mountRecipientAudit(t, { previewResponse: async () => ++previews === 1 ? auditPreview() : pending.promise })
  assert.equal(view.row("최근 요청 수신자", view.section()), "끝 1234")
  const back = [...view.document.querySelectorAll("button")].find(button => button.textContent === "돌아가기")
  await act(async () => { back.click(); await new Promise(resolve => setImmediate(resolve)) })
  assert.equal(view.section(), null)
  await view.render({ open: true })
  assert.equal(view.section(), null)
  assert.equal(view.row("이번 미리보기 수신자"), null)
  await act(async () => { pending.resolve(auditPreview({ latestMessage: null })); await pending.promise })
  assert.equal(view.section(), null)
  assert.equal(view.text().includes(MISSING_HISTORY_COPY), true)
  assert.equal(view.calls.length, 2)
})

test("recipient audit: equal masked suffixes remain two scoped values without a full-number verification claim", async t => {
  const view = await mountRecipientAudit(t, { payload: auditPreview({ latestMessage: auditHistory({ recipientLast4: "5678" }) }) })
  assert.equal(view.row("이번 미리보기 수신자"), "끝 5678")
  assert.equal(view.row("최근 요청 수신자", view.section()), "끝 5678")
  assert.equal(view.text().includes(MASKED_RECIPIENT_COPY), true)
  assert.doesNotMatch(view.text(), /전체 번호 일치|전체 연락처 일치|동일 수신자|수신자 확인 완료|24시간/u)
  assert.equal(view.calls.length, 1)
})

test("recipient audit: a single-source receipt ending in four zeroes is preserved as a valid masked value", async t => {
  const route = syntheticAuditPreviewRoute(auditPreview({ recipientLast4: "0000", latestMessage: auditHistory({ recipientLast4: "0000" }) }))
  const view = await mountRecipientAudit(t, { route })
  assert.equal(view.row("이번 미리보기 수신자"), "끝 0000")
  assert.equal(view.row("최근 요청 수신자", view.section()), "끝 0000")
  assert.match(view.acceptedStatus().textContent, /끝 0000/u)
  assert.equal(view.text().includes(MASKED_RECIPIENT_COPY), true)
  assert.equal(route.activity.previewInserts, 0)
  assert.equal(route.activity.providerCalls, 0)
})

test("recipient audit: an inactive bundle placeholder remains non-sendable without a verified-recipient claim", async t => {
  const base = auditPreview()
  const payload = { ...base, messageKind: "level_test_booking_bundle", recipientLast4: "0000", latestMessage: null,
    readiness: { ...base.readiness, activationMode: "off", activationEligible: false, sendAllowed: false, blockers: ["activation_off"] } }
  const view = await mountRecipientAudit(t, { payload, sourceId: AUDIT_TASK })
  assert.equal(view.row("이번 미리보기 수신자"), "끝 0000")
  assert.equal(view.section(), null)
  assert.equal(view.text().includes(MASKED_RECIPIENT_COPY), true)
  assert.equal(view.text().includes(MISSING_HISTORY_COPY), false)
  assert.doesNotMatch(view.text(), /전체 번호 일치|전체 연락처 일치|동일 수신자|수신자 확인 완료/u)
  assert.equal(view.confirm()?.disabled, true)
  assert.deepEqual(view.calls.map(({ url, body, method }) => ({ url, body, method })), [{
    url: "/api/solapi/registration/bundles/preview", method: "POST",
    body: { messageKind: "level_test_booking_bundle", sourceId: AUDIT_TASK },
  }])
})
