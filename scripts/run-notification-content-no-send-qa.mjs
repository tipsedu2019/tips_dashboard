import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire, syncBuiltinESMExports } from "node:module"
import { fileURLToPath } from "node:url"

import { listNotificationContentContracts } from "../src/features/notifications/notification-content-contract-registry.ts"
import {
  buildGoogleChatCardPayload,
  createGoogleChatProvider,
} from "../src/features/notifications/server/providers/google-chat-provider.ts"

const require = createRequire(import.meta.url)
const http = require("node:http")
const https = require("node:https")

const CONNECTION_SECRET_KEYS = Object.freeze([
  "GOOGLE_CHAT_WEBHOOK_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL",
])

const GOOGLE_CHAT_DESTINATIONS = Object.freeze([
  "google_chat.management",
  "google_chat.executive",
  "google_chat.english",
  "google_chat.math",
  "google_chat.science",
])

const EXPECTED_DESTINATION_BY_AUDIENCE = Object.freeze({
  management_team: "google_chat.management",
  executive_team: "google_chat.executive",
  subject_team: "google_chat.english",
})

const WORKFLOW_HREFS = Object.freeze({
  tasks: "/admin/tasks?taskId=10000000-0000-4000-8000-000000000001",
  word_retests: "/admin/word-retests?taskId=10000000-0000-4000-8000-000000000002",
  registration: "/admin/registration?taskId=10000000-0000-4000-8000-000000000003",
  transfer: "/admin/transfer?flow=operations&taskId=10000000-0000-4000-8000-000000000004",
  withdrawal: "/admin/withdrawal?flow=operations&taskId=10000000-0000-4000-8000-000000000005",
  makeup_requests: "/admin/makeup-requests?request=10000000-0000-4000-8000-000000000006",
  approvals: "/admin/approvals?approvalId=10000000-0000-4000-8000-000000000007",
})

const FAKE_WEBHOOK_URL =
  "https://chat.googleapis.com/v1/spaces/NO_SEND_FIXTURE_123/messages?key=fake-key&token=fake-token"

function externalAttemptError(transport) {
  return new Error(`notification_external_request_blocked:${transport}`)
}

function requestSummary(transport, input) {
  let target = "[unavailable]"
  try {
    const candidate = typeof input === "string" || input instanceof URL
      ? new URL(input)
      : new URL(input?.href || input?.url || "http://invalid.local")
    target = `${candidate.protocol}//${candidate.hostname}${candidate.pathname}`
  } catch {
    target = "[invalid]"
  }
  return Object.freeze({ transport, target })
}

export function installExternalRequestTraps() {
  const attempts = []
  const originalFetch = globalThis.fetch
  const originalHttpRequest = http.request
  const originalHttpGet = http.get
  const originalHttpsRequest = https.request
  const originalHttpsGet = https.get

  globalThis.fetch = async (input) => {
    attempts.push(requestSummary("fetch", input))
    throw externalAttemptError("fetch")
  }
  http.request = (input) => {
    attempts.push(requestSummary("http", input))
    throw externalAttemptError("http")
  }
  http.get = (input) => {
    attempts.push(requestSummary("http", input))
    throw externalAttemptError("http")
  }
  https.request = (input) => {
    attempts.push(requestSummary("https", input))
    throw externalAttemptError("https")
  }
  https.get = (input) => {
    attempts.push(requestSummary("https", input))
    throw externalAttemptError("https")
  }
  syncBuiltinESMExports()

  let restored = false
  return {
    attempts,
    restore() {
      if (restored) return
      restored = true
      globalThis.fetch = originalFetch
      http.request = originalHttpRequest
      http.get = originalHttpGet
      https.request = originalHttpsRequest
      https.get = originalHttpsGet
      syncBuiltinESMExports()
    },
  }
}

function scrubConnectionSecrets() {
  const saved = new Map()
  for (const key of CONNECTION_SECRET_KEYS) {
    if (Object.prototype.hasOwnProperty.call(process.env, key)) saved.set(key, process.env[key])
    delete process.env[key]
  }
  return {
    keys: [...CONNECTION_SECRET_KEYS],
    restore() {
      for (const key of CONNECTION_SECRET_KEYS) delete process.env[key]
      for (const [key, value] of saved) process.env[key] = value
    },
  }
}

function renderGoldenTemplate(template, context) {
  const rendered = template.replace(/\{([a-z][a-z0-9_]*)\}/gu, (_match, key) => {
    if (!Object.prototype.hasOwnProperty.call(context, key) || typeof context[key] !== "string") {
      throw new Error(`notification_golden_render_context_missing:${key}`)
    }
    return context[key]
  })
  if (/[{}]/u.test(rendered)) throw new Error("notification_golden_render_token_unresolved")
  return rendered
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line !== "" || (index > 0 && lines[index - 1] !== ""))
    .join("\n")
    .trim()
}

function identityKey(identity) {
  return [
    identity.workflowKey,
    identity.eventKey,
    identity.audienceKey,
    identity.channelKey,
    identity.ruleVariantKey,
  ].join("|")
}

function loadGoldenFixture() {
  return JSON.parse(readFileSync(
    new URL("../tests/fixtures/notification-content-golden.json", import.meta.url),
    "utf8",
  ))
}

export async function runNotificationContentNoSendQa() {
  const trap = installExternalRequestTraps()
  const secrets = scrubConnectionSecrets()
  try {
    const fixture = loadGoldenFixture()
    const contracts = listNotificationContentContracts()
    const contractByIdentity = new Map(contracts.map((entry) => [identityKey(entry), entry.contract]))
    const goldenByEvent = new Map(fixture.eventGoldens.map((golden) => [golden.eventKey, golden]))
    const destinationCounts = Object.fromEntries(GOOGLE_CHAT_DESTINATIONS.map((key) => [key, 0]))
    const fakeFormattingCalls = []
    const providerAttemptRows = []
    let renderedIdentityCount = 0
    let googleChatIdentityCount = 0
    let exactPayloadCount = 0
    let destinationIsolationChecks = 0

    const provider = createGoogleChatProvider({
      async fetch(input, init) {
        const parsedBody = JSON.parse(String(init?.body || "null"))
        fakeFormattingCalls.push({ input: String(input), init, payload: parsedBody })
        return new Response(JSON.stringify({ name: `spaces/fake/messages/${fakeFormattingCalls.length}` }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      },
    })

    for (const identity of fixture.ruleIdentities) {
      const contract = contractByIdentity.get(identityKey(identity))
      const golden = goldenByEvent.get(identity.goldenEventKey)
      assert.ok(contract, `missing contract:${identityKey(identity)}`)
      assert.ok(golden, `missing golden:${identity.goldenEventKey}`)

      const renderedTitle = renderGoldenTemplate(golden.titleTemplate, golden.representativePayload)
      const renderedBody = renderGoldenTemplate(golden.bodyTemplate, golden.representativePayload)
      assert.equal(renderedTitle, golden.expectedTitle)
      assert.equal(renderedBody, golden.expectedBody)
      renderedIdentityCount += 1

      if (identity.channelKey !== "google_chat") {
        assert.deepEqual(contract.destinationPolicy.allowedConnectionKeys, [])
        continue
      }

      googleChatIdentityCount += 1
      const expectedDestination = EXPECTED_DESTINATION_BY_AUDIENCE[identity.audienceKey]
      assert.ok(expectedDestination, `missing destination:${identity.audienceKey}`)
      assert.equal(contract.destinationPolicy.allowedConnectionKeys.includes(expectedDestination), true)
      const perIdentityDestinations = Object.fromEntries(GOOGLE_CHAT_DESTINATIONS.map((key) => [key, 0]))
      perIdentityDestinations[expectedDestination] = 1
      destinationCounts[expectedDestination] += 1
      assert.equal(Object.values(perIdentityDestinations).filter((count) => count === 1).length, 1)
      assert.equal(Object.values(perIdentityDestinations).filter((count) => count === 0).length, 4)
      destinationIsolationChecks += 1

      const href = WORKFLOW_HREFS[identity.workflowKey]
      assert.ok(href, `missing href:${identity.workflowKey}`)
      const context = {
        delivery_id: "20000000-0000-4000-8000-000000000001",
        claim_token: "20000000-0000-4000-8000-000000000002",
        dispatch_token: "20000000-0000-4000-8000-000000000003",
        status: "sending",
        channel_key: "google_chat",
        connection_key: expectedDestination,
        webhook_url: FAKE_WEBHOOK_URL,
        rendered_title: renderedTitle,
        rendered_body: renderedBody,
        href,
        workflow_key: identity.workflowKey,
      }
      const expected = buildGoogleChatCardPayload(context)
      assert.equal(expected.ok, true)
      const beforeCalls = fakeFormattingCalls.length
      const sent = await provider.send(context)
      assert.equal(sent.status, "sent")
      assert.equal(fakeFormattingCalls.length, beforeCalls + 1)
      assert.deepEqual(fakeFormattingCalls.at(-1).payload, expected.payload)
      exactPayloadCount += 1
    }

    assert.equal(trap.attempts.length, 0)
    const result = {
      passed: true,
      goldenIdentityCount: fixture.ruleIdentities.length,
      renderedIdentityCount,
      googleChatIdentityCount,
      fakeFormattingTransportCallCount: fakeFormattingCalls.length,
      exactPayloadCount,
      externalRequestCount: trap.attempts.length,
      providerAttemptRowCount: providerAttemptRows.length,
      destinationCounts,
      destinationIsolationChecks,
      cronStarted: false,
      workerStarted: false,
      removedConnectionSecrets: secrets.keys,
    }
    return Object.freeze(result)
  } finally {
    secrets.restore()
    trap.restore()
  }
}

async function main() {
  const result = await runNotificationContentNoSendQa()
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (!result.passed) process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "무발송 알림 콘텐츠 QA에 실패했습니다."}\n`)
    process.exitCode = 1
  })
}
