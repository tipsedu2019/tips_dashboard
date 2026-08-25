import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"

import { act, createElement, forwardRef } from "react"
import { createRoot } from "react-dom/client"
import ts from "typescript"
import {
  assertRegistrationCustomerMessagePublicPayload,
  isRegistrationCustomerMessageBundleKind,
} from "../src/features/tasks/registration-customer-message-contract.ts"

const require = createRequire(import.meta.url)
const { JSDOM } = require("jsdom")

const serviceUrl = new URL("../src/features/tasks/registration-customer-message-service.ts", import.meta.url)
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

async function loadService(fetch) {
  const source = await sourceOrEmpty(serviceUrl)
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const sandboxModule = { exports: {} }
  vm.runInNewContext(compiled, {
    module: sandboxModule,
    exports: sandboxModule.exports,
    fetch,
    URLSearchParams,
    require(specifier) {
      if (
        specifier === "./registration-customer-message-contract"
        || specifier === "./registration-customer-message-contract.ts"
      ) {
        return {
          assertRegistrationCustomerMessagePublicPayload,
          isRegistrationCustomerMessageBundleKind,
        }
      }
      throw new Error(`unexpected require: ${specifier}`)
    },
  })
  return sandboxModule.exports
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
    }],
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
  const service = await loadService(async (url, init) => {
    calls.push({ url, init: { ...init, headers: { ...init.headers } } })
    return {
      ok: true,
      json: async () => url.includes("/messages?")
        ? ({ ok: true, messageKind: "waiting_notice", readiness: { sendAllowed: false }, history: [{ messageId: "history-message" }] })
        : ({ ok: true, messageId: "message" }),
    }
  })
  const client = service.createRegistrationCustomerMessageClient({
    getAccessToken: async () => "fixture-token",
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
  const service = await loadService(async (url, init) => {
    calls.push({ url, body: init.body })
    return {
      ok: true,
      json: async () => ({ ok: true, messageId: "message", parentPhone: "01012345678" }),
    }
  })
  const client = service.createRegistrationCustomerMessageClient({ getAccessToken: async () => "fixture-token" })

  await assert.rejects(
    client.preview({ messageKind: "level_test_booking", sourceId: "source-id", phone: "01012345678" }),
    /registration_customer_message_public_payload_forbidden_field:parentPhone/,
  )
  assert.equal(calls[0].body, JSON.stringify({ messageKind: "level_test_booking", sourceId: "source-id" }))

  const reconciler = service.createRegistrationCustomerMessageClient({ getAccessToken: async () => "fixture-token" })
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
  assert.match(source, /SOLAPI 접수 완료 · 학부모 전화 끝/)
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
  assert.match(sharedDialogSource, /<DialogOverlay className=\{overlayClassName\}/)
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
  assert.equal((source.match(/setError\(getRegistrationCustomerMessageErrorMessage\(/g) || []).length, 5)
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
