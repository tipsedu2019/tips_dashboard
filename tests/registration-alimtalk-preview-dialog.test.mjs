import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"

import ts from "typescript"
import { assertRegistrationCustomerMessagePublicPayload } from "../src/features/tasks/registration-customer-message-contract.ts"

const serviceUrl = new URL("../src/features/tasks/registration-customer-message-service.ts", import.meta.url)
const dialogUrl = new URL("../src/features/tasks/registration-alimtalk-preview-dialog.tsx", import.meta.url)

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
      if (specifier === "./registration-customer-message-contract") {
        return { assertRegistrationCustomerMessagePublicPayload }
      }
      throw new Error(`unexpected require: ${specifier}`)
    },
  })
  return sandboxModule.exports
}

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
