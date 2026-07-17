import assert from "node:assert/strict"
import test from "node:test"

import {
  applyDashboardPushSelfTestOutcome,
  resolveDashboardPushState,
} from "../src/lib/dashboard-push-readiness.ts"
import {
  attachDashboardPushRefreshListeners,
  createDashboardPushClient,
} from "../src/lib/dashboard-push-client.ts"

const PROFILE_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_PROFILE_ID = "22222222-2222-4222-8222-222222222222"
const ACCESS_TOKEN = "access-token"
const PUSH_ENDPOINT = "https://push.example.test/subscriptions/current-browser"
const ROTATED_PUSH_ENDPOINT = "https://push.example.test/subscriptions/rotated-browser"
const PUBLIC_KEY_BYTES = Uint8Array.from({ length: 65 }, (_, index) => index + 1)
const OTHER_KEY_BYTES = Uint8Array.from({ length: 65 }, (_, index) => 255 - index)
const PUBLIC_KEY = Buffer.from(PUBLIC_KEY_BYTES).toString("base64url")

function stateFacts(overrides = {}) {
  return {
    browserApisAvailable: true,
    secureContext: true,
    assetsAvailable: true,
    serverCapability: "configured",
    permission: "granted",
    subscriptionPresent: true,
    publicKeyMatches: true,
    ownerBinding: "owned",
    checkFailed: false,
    ...overrides,
  }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function configuredReadiness(state, subscriptionOwned = false) {
  return {
    ok: true,
    state,
    publicKeyConfigured: true,
    privateKeyConfigured: true,
    keysMatch: true,
    contactConfigured: true,
    assetsAvailable: true,
    subscriptionOwned,
    capability: true,
  }
}

function createFakeRuntime(options = {}) {
  const calls = []
  const requests = []
  let permission = options.permission || "granted"
  let ownerState = options.ownerState || "ready"
  let currentSubscription = null

  function createSubscription(keyBytes = PUBLIC_KEY_BYTES, endpoint = PUSH_ENDPOINT) {
    const subscription = {
      endpoint,
      options: {
        applicationServerKey: keyBytes.buffer.slice(
          keyBytes.byteOffset,
          keyBytes.byteOffset + keyBytes.byteLength,
        ),
      },
      toJSON() {
        return {
          endpoint,
          expirationTime: null,
          keys: { p256dh: "p256dh", auth: "auth" },
        }
      },
      async unsubscribe() {
        calls.push("unsubscribe")
        const removed = options.unsubscribeResult !== false
        if (removed) currentSubscription = null
        return removed
      },
    }
    return subscription
  }

  currentSubscription = options.subscription === undefined
    ? createSubscription(options.subscriptionKey || PUBLIC_KEY_BYTES)
    : options.subscription

  const registration = {
    pushManager: {
      async getSubscription() {
        calls.push("getSubscription")
        return currentSubscription
      },
      async subscribe() {
        calls.push("subscribe")
        currentSubscription = createSubscription(
          PUBLIC_KEY_BYTES,
          options.subscribeEndpoint
            || (options.subscriptionKey ? ROTATED_PUSH_ENDPOINT : PUSH_ENDPOINT),
        )
        return currentSubscription
      },
    },
  }

  const runtime = {
    publicKey: PUBLIC_KEY,
    hasBrowserApis() {
      calls.push("browserApis")
      return options.browserApisAvailable !== false
    },
    isSecureContext() {
      calls.push("secureContext")
      return options.secureContext !== false
    },
    async fetch(input, init) {
      const url = String(input)
      calls.push(`fetch:${url}`)
      requests.push({ url, init, body: init?.body ? JSON.parse(String(init.body)) : null })

      if (url === "/sw.js" || url === "/manifest.webmanifest") {
        return new Response(null, { status: options.assetsAvailable === false ? 404 : 200 })
      }
      if (url.startsWith("/api/notifications/push-readiness")) {
        if (init?.method === "POST") {
          return jsonResponse(options.selfTestResponse || {
            ok: true,
            state: "sent",
            code: "push_self_test_sent",
          })
        }
        if (options.serverUnconfigured) {
          return jsonResponse({
            ...configuredReadiness("server_unconfigured"),
            publicKeyConfigured: false,
            privateKeyConfigured: false,
            keysMatch: false,
            contactConfigured: false,
            capability: false,
          })
        }
        const hasEndpoint = url.includes("subscription_endpoint=")
        if (!hasEndpoint) return jsonResponse(configuredReadiness("subscription_missing"))
        if (ownerState === "ready") return jsonResponse(configuredReadiness("ready", true))
        if (ownerState === "subscription_owner_mismatch") {
          return jsonResponse(configuredReadiness("subscription_owner_mismatch"))
        }
        return jsonResponse(configuredReadiness("subscription_missing"))
      }
      if (url === "/api/push-subscriptions" && init?.method === "POST") {
        const body = JSON.parse(String(init.body))
        if (options.bindConflict && body.action !== "rebind") {
          return jsonResponse({
            ok: false,
            code: "push_subscription_owner_conflict",
          }, 409)
        }
        if (
          body.action === "rebind"
          && (ownerState !== "subscription_owner_mismatch" || body.subscription.endpoint !== PUSH_ENDPOINT)
        ) {
          return jsonResponse({ ok: false, code: "push_subscription_store_unavailable" }, 503)
        }
        ownerState = "ready"
        return jsonResponse({ ok: true, status: body.action === "rebind" ? "rebound" : "current" })
      }
      if (url === "/api/push-subscriptions" && init?.method === "DELETE") {
        const deleted = options.deleteOwned !== false
        if (deleted) ownerState = "subscription_missing"
        return jsonResponse({ ok: true, deleted })
      }
      throw new Error(`unexpected request: ${url}`)
    },
    async registerServiceWorker() {
      calls.push("registerServiceWorker")
      if (options.registrationFails) throw new Error("registration failed")
      return registration
    },
    getNotificationPermission() {
      calls.push("permission")
      return permission
    },
    requestNotificationPermission() {
      calls.push("requestPermission")
      permission = options.requestedPermission || "granted"
      return Promise.resolve(permission)
    },
    getUserAgent() {
      return "dashboard-push-test"
    },
  }

  return {
    runtime,
    calls,
    requests,
    registration,
    setOwnerState(value) {
      ownerState = value
    },
  }
}

test("순수 Push 상태 전이는 승인된 진단 순서와 닫힌 상태를 보존한다", () => {
  const cases = [
    [stateFacts({ assetsAvailable: null }), "checking"],
    [stateFacts({ browserApisAvailable: false }), "unsupported"],
    [stateFacts({ secureContext: false }), "insecure"],
    [stateFacts({ assetsAvailable: false }), "asset_missing"],
    [stateFacts({ serverCapability: "unconfigured" }), "server_unconfigured"],
    [stateFacts({ permission: "default" }), "permission_prompt"],
    [stateFacts({ permission: "denied" }), "permission_denied"],
    [stateFacts({ subscriptionPresent: false }), "subscription_missing"],
    [stateFacts({ publicKeyMatches: false }), "subscription_owner_mismatch"],
    [stateFacts({ ownerBinding: "missing" }), "subscription_missing"],
    [stateFacts({ ownerBinding: "mismatch" }), "subscription_owner_mismatch"],
    [stateFacts(), "ready"],
    [stateFacts({ checkFailed: true }), "check_failed"],
  ]

  for (const [facts, expected] of cases) {
    assert.equal(resolveDashboardPushState(facts), expected)
  }

  assert.equal(resolveDashboardPushState(stateFacts({
    browserApisAvailable: false,
    secureContext: false,
    assetsAvailable: false,
    serverCapability: "unconfigured",
  })), "unsupported")
  assert.equal(resolveDashboardPushState(stateFacts({
    secureContext: false,
    assetsAvailable: false,
    serverCapability: "unconfigured",
  })), "insecure")
  assert.equal(resolveDashboardPushState(stateFacts({
    assetsAvailable: false,
    serverCapability: "unconfigured",
  })), "server_unconfigured")
  assert.equal(resolveDashboardPushState(stateFacts({
    assetsAvailable: false,
    permission: "default",
  })), "permission_prompt")
})

test("고정 self-test 결과만 ready 상태에서 닫힌 결과로 전이한다", () => {
  assert.equal(applyDashboardPushSelfTestOutcome("ready", "sent"), "self_test_sent")
  assert.equal(applyDashboardPushSelfTestOutcome("ready", "expired"), "self_test_expired")
  assert.equal(applyDashboardPushSelfTestOutcome("ready", "failed"), "self_test_failed")
  assert.throws(
    () => applyDashboardPushSelfTestOutcome("subscription_missing", "sent"),
    /ready/,
  )
})

test("상태 확인은 브라우저 API, secure context, 서버 VAPID, 권한 순서이며 권한을 요청하지 않는다", async () => {
  const fake = createFakeRuntime({ permission: "default" })
  const client = createDashboardPushClient(fake.runtime)

  const readiness = await client.refresh({
    accessToken: ACCESS_TOKEN,
    profileId: PROFILE_ID,
    reason: "profile",
  })

  assert.equal(readiness.state, "permission_prompt")
  assert.equal(readiness.profileId, PROFILE_ID)
  assert.deepEqual(fake.calls, [
    "browserApis",
    "secureContext",
    "fetch:/api/notifications/push-readiness",
    "permission",
  ])
  assert.equal(fake.calls.includes("requestPermission"), false)
})

test("insecure context와 asset 실패는 승인된 앞 단계까지만 검사하고 권한을 요청하지 않는다", async () => {
  const insecure = createFakeRuntime({ secureContext: false, permission: "default" })
  const insecureClient = createDashboardPushClient(insecure.runtime)
  assert.equal((await insecureClient.refresh({
    accessToken: ACCESS_TOKEN,
    profileId: PROFILE_ID,
    reason: "open",
  })).state, "insecure")
  assert.deepEqual(insecure.calls, ["browserApis", "secureContext"])

  const missingAsset = createFakeRuntime({ assetsAvailable: false, permission: "granted" })
  const assetClient = createDashboardPushClient(missingAsset.runtime)
  assert.equal((await assetClient.refresh({
    accessToken: ACCESS_TOKEN,
    profileId: PROFILE_ID,
    reason: "open",
  })).state, "asset_missing")
  assert.equal(missingAsset.calls.includes("registerServiceWorker"), false)
  assert.equal(missingAsset.calls.some((call) => call.includes("push-readiness")), true)
  assert.ok(
    missingAsset.calls.indexOf("permission")
      < missingAsset.calls.indexOf("fetch:/sw.js"),
  )
  assert.equal(missingAsset.calls.includes("requestPermission"), false)

  const permissionFirst = createFakeRuntime({ assetsAvailable: false, permission: "default" })
  const permissionFirstClient = createDashboardPushClient(permissionFirst.runtime)
  assert.equal((await permissionFirstClient.refresh({
    accessToken: ACCESS_TOKEN,
    profileId: PROFILE_ID,
    reason: "open",
  })).state, "permission_prompt")
  assert.equal(permissionFirst.calls.includes("fetch:/sw.js"), false)
})

test("브라우저 build 공개키가 없으면 서버가 준비돼도 권한 단계 전에 server_unconfigured로 닫는다", async () => {
  const fake = createFakeRuntime({ permission: "default" })
  fake.runtime.publicKey = ""
  const client = createDashboardPushClient(fake.runtime)

  const readiness = await client.refresh({
    accessToken: ACCESS_TOKEN,
    profileId: PROFILE_ID,
    reason: "open",
  })

  assert.equal(readiness.state, "server_unconfigured")
  assert.equal(fake.calls.includes("permission"), false)
  assert.equal(fake.calls.includes("requestPermission"), false)
})

test("권한 요청은 permission_prompt를 확인한 명시적 사용자 action 안에서만 시작한다", async () => {
  const fake = createFakeRuntime({ permission: "default", subscription: null })
  const client = createDashboardPushClient(fake.runtime)
  await client.refresh({ accessToken: ACCESS_TOKEN, profileId: PROFILE_ID, reason: "open" })

  fake.calls.length = 0
  const readiness = await client.requestPermissionAndBind({
    accessToken: ACCESS_TOKEN,
    profileId: PROFILE_ID,
  })

  assert.equal(fake.calls[0], "requestPermission")
  assert.ok(fake.calls.indexOf("requestPermission") < fake.calls.indexOf("getSubscription"))
  assert.equal(readiness.state, "ready")
  const bindRequest = fake.requests.find(({ url, init }) => (
    url === "/api/push-subscriptions" && init?.method === "POST"
  ))
  assert.deepEqual(Object.keys(bindRequest.body).sort(), ["subscription", "userAgent"])
})

test("공개키 교체와 profile 소유권 불일치는 서로 다른 안전한 명시적 복구 계약을 사용한다", async () => {
  const keyMismatch = createFakeRuntime({ subscriptionKey: OTHER_KEY_BYTES })
  const keyClient = createDashboardPushClient(keyMismatch.runtime)
  const keyState = await keyClient.refresh({
    accessToken: ACCESS_TOKEN,
    profileId: PROFILE_ID,
    reason: "profile",
  })
  assert.equal(keyState.state, "subscription_owner_mismatch")
  assert.equal(keyMismatch.requests.some(({ init }) => init?.method === "POST"), false)

  const rebound = await keyClient.rebind({ accessToken: ACCESS_TOKEN, profileId: PROFILE_ID })
  assert.equal(rebound.state, "ready")
  assert.ok(
    keyMismatch.calls.indexOf("fetch:/api/push-subscriptions")
      < keyMismatch.calls.indexOf("unsubscribe"),
  )
  assert.ok(keyMismatch.calls.indexOf("unsubscribe") < keyMismatch.calls.indexOf("subscribe"))
  const rotatedBindRequest = keyMismatch.requests.find(({ url, init }) => (
    url === "/api/push-subscriptions" && init?.method === "POST"
  ))
  assert.deepEqual(Object.keys(rotatedBindRequest.body).sort(), ["subscription", "userAgent"])
  assert.equal(rotatedBindRequest.body.subscription.endpoint, ROTATED_PUSH_ENDPOINT)

  const ownerMismatch = createFakeRuntime({ ownerState: "subscription_owner_mismatch" })
  const ownerClient = createDashboardPushClient(ownerMismatch.runtime)
  assert.equal((await ownerClient.refresh({
    accessToken: ACCESS_TOKEN,
    profileId: PROFILE_ID,
    reason: "profile",
  })).state, "subscription_owner_mismatch")
  assert.equal(ownerMismatch.requests.some(({ init }) => init?.method === "POST"), false)
  assert.equal((await ownerClient.rebind({
    accessToken: ACCESS_TOKEN,
    profileId: PROFILE_ID,
  })).state, "ready")
  const ownerRebindRequest = ownerMismatch.requests.find(({ url, init }) => (
    url === "/api/push-subscriptions" && init?.method === "POST"
  ))
  assert.equal(ownerRebindRequest.body.action, "rebind")
})

test("공개키 교체 중 stale profile DELETE가 0행이면 로컬 구독과 새 연결을 건드리지 않는다", async () => {
  const fake = createFakeRuntime({
    subscriptionKey: OTHER_KEY_BYTES,
    deleteOwned: false,
  })
  const client = createDashboardPushClient(fake.runtime)
  assert.equal((await client.refresh({
    accessToken: ACCESS_TOKEN,
    profileId: PROFILE_ID,
    reason: "profile",
  })).state, "subscription_owner_mismatch")

  await assert.rejects(
    client.rebind({ accessToken: ACCESS_TOKEN, profileId: PROFILE_ID }),
    /소유 계정이 변경/,
  )
  assert.equal(fake.calls.includes("unsubscribe"), false)
  assert.equal(fake.calls.includes("subscribe"), false)
  assert.equal(fake.requests.some(({ url, init }) => (
    url === "/api/push-subscriptions" && init?.method === "POST"
  )), false)
})

test("일반 bind의 소유권 충돌은 성공으로 숨기지 않고 구체적인 오류를 반환한다", async () => {
  const fake = createFakeRuntime({ subscription: null, bindConflict: true })
  const client = createDashboardPushClient(fake.runtime)
  await client.refresh({ accessToken: ACCESS_TOKEN, profileId: PROFILE_ID, reason: "open" })

  await assert.rejects(
    client.requestPermissionAndBind({ accessToken: ACCESS_TOKEN, profileId: PROFILE_ID }),
    /다른 계정/,
  )
})

test("서버에 없는 기존 로컬 구독은 재사용하지 않고 새 구독으로 교체한다", async () => {
  const fake = createFakeRuntime({ ownerState: "subscription_missing" })
  const client = createDashboardPushClient(fake.runtime)
  assert.equal((await client.refresh({
    accessToken: ACCESS_TOKEN,
    profileId: PROFILE_ID,
    reason: "open",
  })).state, "subscription_missing")

  fake.calls.length = 0
  assert.equal((await client.requestPermissionAndBind({
    accessToken: ACCESS_TOKEN,
    profileId: PROFILE_ID,
  })).state, "ready")
  assert.ok(fake.calls.indexOf("unsubscribe") < fake.calls.indexOf("subscribe"))
})

test("self-test는 ready인 현재 profile 구독만 고정 payload로 보낸다", async () => {
  const fake = createFakeRuntime()
  const client = createDashboardPushClient(fake.runtime)
  await client.refresh({ accessToken: ACCESS_TOKEN, profileId: PROFILE_ID, reason: "open" })

  const result = await client.sendSelfTest({ accessToken: ACCESS_TOKEN, profileId: PROFILE_ID })
  assert.equal(result.state, "self_test_sent")
  const request = fake.requests.find(({ url, init }) => (
    url === "/api/notifications/push-readiness" && init?.method === "POST"
  ))
  assert.deepEqual(Object.keys(request.body).sort(), ["action", "subscription_endpoint"])
  assert.deepEqual(request.body, {
    action: "send_test",
    subscription_endpoint: PUSH_ENDPOINT,
  })

  const notReady = createFakeRuntime({ ownerState: "subscription_missing" })
  const notReadyClient = createDashboardPushClient(notReady.runtime)
  await notReadyClient.refresh({
    accessToken: ACCESS_TOKEN,
    profileId: PROFILE_ID,
    reason: "open",
  })
  await assert.rejects(
    notReadyClient.sendSelfTest({ accessToken: ACCESS_TOKEN, profileId: PROFILE_ID }),
    /ready/,
  )
  assert.equal(notReady.requests.some(({ init }) => init?.method === "POST"), false)
})

test("self-test 감사 저장 실패가 이미 확정된 sent 결과를 실패로 바꾸지 않는다", async () => {
  const fake = createFakeRuntime({
    selfTestResponse: {
      ok: true,
      state: "sent",
      code: "push_self_test_sent",
      auditRecorded: false,
      warningCode: "push_self_test_audit_unavailable",
    },
  })
  const client = createDashboardPushClient(fake.runtime)
  await client.refresh({ accessToken: ACCESS_TOKEN, profileId: PROFILE_ID, reason: "open" })

  const result = await client.sendSelfTest({ accessToken: ACCESS_TOKEN, profileId: PROFILE_ID })
  assert.equal(result.state, "self_test_sent")
  assert.equal(result.code, "push_self_test_audit_unavailable")
})

test("감사와 만료 구독 정리가 함께 실패하면 정리 실패 원인을 보존한다", async () => {
  const responseBody = {
    ok: false,
    state: "expired",
    code: "push_subscription_expired_cleanup_unavailable",
    auditRecorded: false,
    warningCode: "push_self_test_audit_unavailable",
  }
  const fake = createFakeRuntime({ selfTestResponse: responseBody })
  const originalFetch = fake.runtime.fetch
  fake.runtime.fetch = async (input, init) => {
    if (String(input) === "/api/notifications/push-readiness" && init?.method === "POST") {
      return jsonResponse(responseBody, 410)
    }
    return originalFetch(input, init)
  }
  const client = createDashboardPushClient(fake.runtime)
  await client.refresh({ accessToken: ACCESS_TOKEN, profileId: PROFILE_ID, reason: "open" })

  const result = await client.sendSelfTest({ accessToken: ACCESS_TOKEN, profileId: PROFILE_ID })
  assert.equal(result.state, "self_test_expired")
  assert.equal(result.code, "push_subscription_expired_cleanup_unavailable")
})

test("만료 self-test는 서버 행과 함께 브라우저 구독도 제거해 재연결 루프를 막는다", async () => {
  const fake = createFakeRuntime({
    selfTestResponse: {
      ok: false,
      state: "expired",
      code: "push_subscription_expired",
    },
  })
  const originalFetch = fake.runtime.fetch
  fake.runtime.fetch = async (input, init) => {
    if (String(input) === "/api/notifications/push-readiness" && init?.method === "POST") {
      return jsonResponse(fake.runtime.selfTestResponse || {
        ok: false,
        state: "expired",
        code: "push_subscription_expired",
      }, 410)
    }
    return originalFetch(input, init)
  }
  const client = createDashboardPushClient(fake.runtime)
  await client.refresh({ accessToken: ACCESS_TOKEN, profileId: PROFILE_ID, reason: "open" })

  const result = await client.sendSelfTest({ accessToken: ACCESS_TOKEN, profileId: PROFILE_ID })
  assert.equal(result.state, "self_test_expired")
  assert.equal(fake.calls.includes("unsubscribe"), true)
  assert.equal((await client.refresh({
    accessToken: ACCESS_TOKEN,
    profileId: PROFILE_ID,
    reason: "manual",
  })).state, "subscription_missing")
})

test("만료 구독의 로컬 정리가 실패해도 같은 endpoint를 일반 bind로 되살리지 않는다", async () => {
  const fake = createFakeRuntime({ unsubscribeResult: false })
  const originalFetch = fake.runtime.fetch
  fake.runtime.fetch = async (input, init) => {
    if (String(input) === "/api/notifications/push-readiness" && init?.method === "POST") {
      return jsonResponse({
        ok: false,
        state: "expired",
        code: "push_subscription_expired",
      }, 410)
    }
    return originalFetch(input, init)
  }
  const client = createDashboardPushClient(fake.runtime)
  await client.refresh({ accessToken: ACCESS_TOKEN, profileId: PROFILE_ID, reason: "open" })

  const expired = await client.sendSelfTest({ accessToken: ACCESS_TOKEN, profileId: PROFILE_ID })
  assert.equal(expired.state, "self_test_expired")
  assert.equal(expired.code, "push_expired_subscription_cleanup_failed")
  fake.setOwnerState("subscription_missing")
  assert.equal((await client.refresh({
    accessToken: ACCESS_TOKEN,
    profileId: PROFILE_ID,
    reason: "manual",
  })).state, "subscription_missing")

  const postCountBefore = fake.requests.filter(({ url, init }) => (
    url === "/api/push-subscriptions" && init?.method === "POST"
  )).length
  await assert.rejects(
    client.requestPermissionAndBind({ accessToken: ACCESS_TOKEN, profileId: PROFILE_ID }),
    /브라우저의 Push 구독/,
  )
  const postCountAfter = fake.requests.filter(({ url, init }) => (
    url === "/api/push-subscriptions" && init?.method === "POST"
  )).length
  assert.equal(postCountAfter, postCountBefore)
  assert.equal(fake.calls.includes("subscribe"), false)
})

test("브라우저가 unsubscribe 실패를 반환하면 해제 성공으로 표시하지 않는다", async () => {
  const fake = createFakeRuntime({ unsubscribeResult: false })
  const client = createDashboardPushClient(fake.runtime)
  await client.refresh({ accessToken: ACCESS_TOKEN, profileId: PROFILE_ID, reason: "open" })

  await assert.rejects(
    client.unsubscribe({ accessToken: ACCESS_TOKEN, profileId: PROFILE_ID }),
    /브라우저의 Push 구독/,
  )
})

test("stale profile의 DELETE가 0행이면 새 소유자의 브라우저 구독을 끊지 않는다", async () => {
  const fake = createFakeRuntime({ deleteOwned: false })
  const client = createDashboardPushClient(fake.runtime)
  await client.refresh({ accessToken: ACCESS_TOKEN, profileId: PROFILE_ID, reason: "open" })

  await assert.rejects(
    client.unsubscribe({ accessToken: ACCESS_TOKEN, profileId: PROFILE_ID }),
    /소유 계정이 변경/,
  )
  assert.equal(fake.calls.includes("unsubscribe"), false)
})

test("profile 전환은 진행 중인 self-test 요청을 중단하고 새 profile 상태를 보존한다", async () => {
  const fake = createFakeRuntime()
  const originalFetch = fake.runtime.fetch
  let started
  const selfTestStarted = new Promise((resolve) => {
    started = resolve
  })
  let selfTestSignal
  fake.runtime.fetch = async (input, init) => {
    if (String(input) === "/api/notifications/push-readiness" && init?.method === "POST") {
      selfTestSignal = init.signal
      started()
      return new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("중단됨", "AbortError")))
      })
    }
    return originalFetch(input, init)
  }
  const client = createDashboardPushClient(fake.runtime)
  await client.refresh({ accessToken: ACCESS_TOKEN, profileId: PROFILE_ID, reason: "open" })

  const pending = client.sendSelfTest({ accessToken: ACCESS_TOKEN, profileId: PROFILE_ID })
  await selfTestStarted
  client.invalidate(OTHER_PROFILE_ID)
  await pending

  assert.equal(selfTestSignal.aborted, true)
  assert.equal(client.getCurrent().profileId, OTHER_PROFILE_ID)
  assert.equal(client.getCurrent().state, "checking")
})

test("profile이 바뀐 뒤 늦게 끝난 refresh는 최신 profile 상태를 덮어쓰지 않는다", async () => {
  let resolveFirst
  const firstReadiness = new Promise((resolve) => {
    resolveFirst = resolve
  })
  const fake = createFakeRuntime()
  const originalFetch = fake.runtime.fetch
  fake.runtime.fetch = async (input, init) => {
    const url = String(input)
    const token = new Headers(init?.headers).get("Authorization")
    if (url === "/api/notifications/push-readiness" && token === "Bearer old-token") {
      return firstReadiness
    }
    if (url === "/api/notifications/push-readiness" && token === "Bearer new-token") {
      return jsonResponse({
        ...configuredReadiness("server_unconfigured"),
        publicKeyConfigured: false,
        privateKeyConfigured: false,
        keysMatch: false,
        contactConfigured: false,
        capability: false,
      })
    }
    return originalFetch(input, init)
  }
  const client = createDashboardPushClient(fake.runtime)

  const oldRefresh = client.refresh({
    accessToken: "old-token",
    profileId: PROFILE_ID,
    reason: "profile",
  })
  await Promise.resolve()
  const newReadiness = await client.refresh({
    accessToken: "new-token",
    profileId: OTHER_PROFILE_ID,
    reason: "profile",
  })
  assert.equal(newReadiness.state, "server_unconfigured")
  assert.equal(newReadiness.profileId, OTHER_PROFILE_ID)

  resolveFirst(jsonResponse(configuredReadiness("subscription_missing")))
  const staleResult = await oldRefresh
  assert.equal(staleResult.state, "server_unconfigured")
  assert.equal(staleResult.profileId, OTHER_PROFILE_ID)
  assert.deepEqual(client.getCurrent(), newReadiness)
})

test("focus와 visible visibilitychange만 refresh reason을 전달하고 cleanup한다", () => {
  const windowListeners = new Map()
  const documentListeners = new Map()
  let visibilityState = "hidden"
  const reasons = []
  const detach = attachDashboardPushRefreshListeners(
    (reason) => reasons.push(reason),
    {
      windowTarget: {
        addEventListener(type, listener) {
          windowListeners.set(type, listener)
        },
        removeEventListener(type) {
          windowListeners.delete(type)
        },
      },
      documentTarget: {
        addEventListener(type, listener) {
          documentListeners.set(type, listener)
        },
        removeEventListener(type) {
          documentListeners.delete(type)
        },
      },
      getVisibilityState: () => visibilityState,
    },
  )

  windowListeners.get("focus")()
  documentListeners.get("visibilitychange")()
  visibilityState = "visible"
  documentListeners.get("visibilitychange")()
  assert.deepEqual(reasons, ["focus", "visibility"])

  detach()
  assert.equal(windowListeners.size, 0)
  assert.equal(documentListeners.size, 0)
})
