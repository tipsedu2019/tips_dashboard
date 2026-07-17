"use client"

import {
  applyDashboardPushSelfTestOutcome,
  resolveDashboardPushState,
  type DashboardPushSelfTestOutcome,
  type DashboardPushState,
  type DashboardPushStateFacts,
} from "./dashboard-push-readiness.ts"

export {
  DASHBOARD_PUSH_STATES,
  type DashboardPushState,
} from "./dashboard-push-readiness.ts"

export type DashboardPushAuthContext = Readonly<{
  accessToken: string
  profileId: string
}>

export type DashboardPushRefreshReason =
  | "profile"
  | "open"
  | "focus"
  | "visibility"
  | "manual"

export type DashboardPushRefreshInput = DashboardPushAuthContext & Readonly<{
  reason: DashboardPushRefreshReason
}>

export type DashboardPushReadiness = Readonly<{
  state: DashboardPushState
  code: string
  profileId: string
}>

type DashboardPushSubscriptionLike = Readonly<{
  endpoint: string
  options: Readonly<{
    applicationServerKey: ArrayBuffer | null
  }>
  toJSON(): unknown
  unsubscribe(): Promise<boolean>
}>

type DashboardPushRegistrationLike = Readonly<{
  pushManager: Readonly<{
    getSubscription(): Promise<DashboardPushSubscriptionLike | null>
    subscribe(options: {
      userVisibleOnly: true
      applicationServerKey: Uint8Array<ArrayBuffer>
    }): Promise<DashboardPushSubscriptionLike>
  }>
}>

export type DashboardPushClientRuntime = Readonly<{
  publicKey: string
  hasBrowserApis(): boolean
  isSecureContext(): boolean
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  registerServiceWorker(): Promise<DashboardPushRegistrationLike>
  getNotificationPermission(): NotificationPermission
  requestNotificationPermission(): Promise<NotificationPermission>
  getUserAgent(): string
}>

type ServerReadinessState =
  | "server_unconfigured"
  | "asset_missing"
  | "subscription_missing"
  | "subscription_owner_mismatch"
  | "ready"

type ServerReadiness = Readonly<{
  state: ServerReadinessState
  keysMatch: boolean
  assetsAvailable: boolean
  subscriptionOwned: boolean
  capability: boolean
}>

type RefreshListenerSources = Readonly<{
  windowTarget: Pick<Window, "addEventListener" | "removeEventListener">
  documentTarget: Pick<Document, "addEventListener" | "removeEventListener">
  getVisibilityState(): DocumentVisibilityState
}>

const DASHBOARD_PUSH_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY
  || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  || ""

const SERVER_READINESS_STATES = new Set<ServerReadinessState>([
  "server_unconfigured",
  "asset_missing",
  "subscription_missing",
  "subscription_owner_mismatch",
  "ready",
])

const REFRESH_REASONS = new Set<DashboardPushRefreshReason>([
  "profile",
  "open",
  "focus",
  "visibility",
  "manual",
])

function hasBrowserPushApis() {
  return (
    typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window
  )
}

function createReadiness(
  state: DashboardPushState,
  profileId: string,
  code = `push_${state}`,
): DashboardPushReadiness {
  return { state, code, profileId }
}

function checkingReadiness(profileId: string) {
  return createReadiness("checking", profileId)
}

function checkFailedReadiness(profileId: string, code = "push_readiness_check_failed") {
  return createReadiness("check_failed", profileId, code)
}

function validateAuthContext(input: DashboardPushAuthContext) {
  const accessToken = typeof input?.accessToken === "string" ? input.accessToken.trim() : ""
  const profileId = typeof input?.profileId === "string" ? input.profileId.trim() : ""
  if (!accessToken || !profileId) {
    throw new Error("Push 상태 확인에 필요한 로그인 정보가 없습니다.")
  }
  return { accessToken, profileId }
}

function validateRefreshInput(input: DashboardPushRefreshInput) {
  const auth = validateAuthContext(input)
  if (!REFRESH_REASONS.has(input.reason)) {
    throw new Error("Push 상태 갱신 사유가 올바르지 않습니다.")
  }
  return { ...auth, reason: input.reason }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function readJson(response: Response) {
  return response.json().catch(() => null) as Promise<unknown>
}

function normalizeServerReadiness(value: unknown): ServerReadiness {
  if (
    !isRecord(value)
    || value.ok !== true
    || typeof value.state !== "string"
    || !SERVER_READINESS_STATES.has(value.state as ServerReadinessState)
    || typeof value.keysMatch !== "boolean"
    || typeof value.assetsAvailable !== "boolean"
    || typeof value.subscriptionOwned !== "boolean"
    || typeof value.capability !== "boolean"
  ) {
    throw new Error("Push 준비 상태 응답이 안전하지 않습니다.")
  }
  return {
    state: value.state as ServerReadinessState,
    keysMatch: value.keysMatch,
    assetsAvailable: value.assetsAvailable,
    subscriptionOwned: value.subscriptionOwned,
    capability: value.capability,
  }
}

function initialFacts(): DashboardPushStateFacts {
  return {
    browserApisAvailable: true,
    secureContext: null,
    assetsAvailable: null,
    serverCapability: null,
    permission: null,
    subscriptionPresent: null,
    publicKeyMatches: null,
    ownerBinding: null,
    checkFailed: false,
  }
}

function stateFromFacts(
  facts: DashboardPushStateFacts,
  profileId: string,
  code?: string,
) {
  return createReadiness(resolveDashboardPushState(facts), profileId, code)
}

export function urlBase64ToUint8Array(base64String: string) {
  const normalized = base64String.trim()
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4)
  const base64 = `${normalized}${padding}`.replace(/-/g, "+").replace(/_/g, "/")
  const rawData = globalThis.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index)
  }
  return outputArray
}

function subscriptionUsesPublicKey(
  subscription: DashboardPushSubscriptionLike,
  publicKey: string,
) {
  const actualKey = subscription.options.applicationServerKey
  if (!actualKey || !publicKey) return false
  try {
    const actual = new Uint8Array(actualKey)
    const expected = urlBase64ToUint8Array(publicKey)
    return actual.length === expected.length
      && actual.every((value, index) => value === expected[index])
  } catch {
    return false
  }
}

function productionRuntime(): DashboardPushClientRuntime {
  return {
    publicKey: DASHBOARD_PUSH_PUBLIC_KEY,
    hasBrowserApis: hasBrowserPushApis,
    isSecureContext: () => typeof window !== "undefined" && window.isSecureContext,
    fetch: (input, init) => globalThis.fetch(input, init),
    registerServiceWorker: () => (
      navigator.serviceWorker.register("/sw.js") as unknown as Promise<DashboardPushRegistrationLike>
    ),
    getNotificationPermission: () => Notification.permission,
    requestNotificationPermission: () => Notification.requestPermission(),
    getUserAgent: () => navigator.userAgent,
  }
}

export function createDashboardPushClient(runtime: DashboardPushClientRuntime) {
  let refreshGeneration = 0
  let activeProfileId = ""
  let currentReadiness = checkingReadiness("")
  let currentRegistration: DashboardPushRegistrationLike | null = null
  let activeMutationController: AbortController | null = null

  function isCurrent(generation: number, profileId: string) {
    return refreshGeneration === generation && activeProfileId === profileId
  }

  function cancelActiveMutation() {
    activeMutationController?.abort()
    activeMutationController = null
  }

  function begin(profileId: string) {
    cancelActiveMutation()
    refreshGeneration += 1
    activeProfileId = profileId
    return refreshGeneration
  }

  function beginMutation(profileId: string) {
    cancelActiveMutation()
    refreshGeneration += 1
    activeProfileId = profileId
    const controller = new AbortController()
    activeMutationController = controller
    return { generation: refreshGeneration, controller }
  }

  async function fetchServerReadiness(accessToken: string, endpoint?: string) {
    const query = endpoint
      ? `?subscription_endpoint=${encodeURIComponent(endpoint)}`
      : ""
    const response = await runtime.fetch(`/api/notifications/push-readiness${query}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
      credentials: "same-origin",
    })
    if (!response.ok) throw new Error("Push 서버 준비 상태를 확인하지 못했습니다.")
    return normalizeServerReadiness(await readJson(response))
  }

  async function inspect(
    auth: DashboardPushAuthContext,
  ): Promise<Readonly<{
    readiness: DashboardPushReadiness
    registration: DashboardPushRegistrationLike | null
  }>> {
    let facts = initialFacts()
    facts = { ...facts, browserApisAvailable: runtime.hasBrowserApis() }
    if (!facts.browserApisAvailable) {
      return { readiness: stateFromFacts(facts, auth.profileId), registration: null }
    }

    facts = { ...facts, secureContext: runtime.isSecureContext() }
    if (!facts.secureContext) {
      return { readiness: stateFromFacts(facts, auth.profileId), registration: null }
    }

    let server: ServerReadiness
    try {
      server = await fetchServerReadiness(auth.accessToken)
    } catch {
      facts = { ...facts, checkFailed: true }
      return {
        readiness: stateFromFacts(facts, auth.profileId, "push_server_readiness_check_failed"),
        registration: null,
      }
    }
    if (
      server.state === "server_unconfigured"
      || !server.keysMatch
      || !runtime.publicKey
      || (!server.capability && server.state !== "asset_missing")
    ) {
      facts = { ...facts, serverCapability: "unconfigured" }
      return { readiness: stateFromFacts(facts, auth.profileId), registration: null }
    }
    facts = {
      ...facts,
      serverCapability: server.state === "asset_missing" || !server.assetsAvailable
        ? "asset_missing"
        : "configured",
    }

    const permission = runtime.getNotificationPermission()
    facts = { ...facts, permission }
    if (permission !== "granted") {
      return { readiness: stateFromFacts(facts, auth.profileId), registration: null }
    }

    let registration: DashboardPushRegistrationLike
    try {
      const [serviceWorkerAsset, manifestAsset] = await Promise.all([
        runtime.fetch("/sw.js", {
          cache: "no-store",
          credentials: "same-origin",
        }),
        runtime.fetch("/manifest.webmanifest", {
          cache: "no-store",
          credentials: "same-origin",
        }),
      ])
      facts = {
        ...facts,
        assetsAvailable: server.assetsAvailable && serviceWorkerAsset.ok && manifestAsset.ok,
      }
      if (!facts.assetsAvailable) {
        return { readiness: stateFromFacts(facts, auth.profileId), registration: null }
      }
      registration = await runtime.registerServiceWorker()
    } catch {
      facts = { ...facts, assetsAvailable: false }
      return { readiness: stateFromFacts(facts, auth.profileId), registration: null }
    }

    let subscription: DashboardPushSubscriptionLike | null
    try {
      subscription = await registration.pushManager.getSubscription()
    } catch {
      facts = { ...facts, checkFailed: true }
      return {
        readiness: stateFromFacts(facts, auth.profileId, "push_subscription_check_failed"),
        registration,
      }
    }
    facts = { ...facts, subscriptionPresent: Boolean(subscription) }
    if (!subscription) {
      return { readiness: stateFromFacts(facts, auth.profileId), registration }
    }

    const publicKeyMatches = subscriptionUsesPublicKey(subscription, runtime.publicKey)
    facts = { ...facts, publicKeyMatches }
    if (!publicKeyMatches) {
      return {
        readiness: stateFromFacts(facts, auth.profileId, "push_public_key_mismatch"),
        registration,
      }
    }

    let ownership: ServerReadiness
    try {
      ownership = await fetchServerReadiness(auth.accessToken, subscription.endpoint)
    } catch {
      facts = { ...facts, checkFailed: true }
      return {
        readiness: stateFromFacts(facts, auth.profileId, "push_ownership_check_failed"),
        registration,
      }
    }
    if (ownership.state === "server_unconfigured" || !ownership.capability || !ownership.keysMatch) {
      facts = { ...facts, serverCapability: "unconfigured" }
      return { readiness: stateFromFacts(facts, auth.profileId), registration }
    }
    if (ownership.state === "asset_missing" || !ownership.assetsAvailable) {
      facts = { ...facts, serverCapability: "asset_missing" }
      return { readiness: stateFromFacts(facts, auth.profileId), registration }
    }
    facts = {
      ...facts,
      ownerBinding: ownership.state === "ready" && ownership.subscriptionOwned
        ? "owned"
        : ownership.state === "subscription_owner_mismatch"
          ? "mismatch"
          : "missing",
    }
    return { readiness: stateFromFacts(facts, auth.profileId), registration }
  }

  async function refresh(input: DashboardPushRefreshInput) {
    const auth = validateRefreshInput(input)
    const generation = begin(auth.profileId)
    currentRegistration = null
    currentReadiness = checkingReadiness(auth.profileId)

    let result: Awaited<ReturnType<typeof inspect>>
    try {
      result = await inspect(auth)
    } catch {
      result = {
        readiness: checkFailedReadiness(auth.profileId),
        registration: null,
      }
    }
    if (!isCurrent(generation, auth.profileId)) return currentReadiness

    currentRegistration = result.registration
    currentReadiness = result.readiness
    return currentReadiness
  }

  function getCurrent() {
    return currentReadiness
  }

  function invalidate(profileId = "") {
    begin(profileId)
    currentRegistration = null
    currentReadiness = checkingReadiness(profileId)
    return currentReadiness
  }

  function requireActionState(
    input: DashboardPushAuthContext,
    allowedStates: readonly DashboardPushState[],
  ) {
    const auth = validateAuthContext(input)
    if (
      currentReadiness.profileId !== auth.profileId
      || !allowedStates.includes(currentReadiness.state)
      || !currentRegistration
    ) {
      throw new Error(`Push action은 ${allowedStates.join(" 또는 ")} 상태에서만 실행할 수 있습니다.`)
    }
    return { auth, registration: currentRegistration }
  }

  async function persistSubscription(
    subscription: DashboardPushSubscriptionLike,
    accessToken: string,
    action?: "rebind",
    signal?: AbortSignal,
  ) {
    const body = {
      ...(action ? { action } : {}),
      subscription: subscription.toJSON(),
      userAgent: runtime.getUserAgent(),
    }
    const response = await runtime.fetch("/api/push-subscriptions", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify(body),
      signal,
    })
    if (response.ok) return

    const payload = await readJson(response)
    if (
      response.status === 409
      && isRecord(payload)
      && payload.code === "push_subscription_owner_conflict"
    ) {
      throw new Error("이 브라우저의 Push 구독이 다른 계정에 연결되어 있습니다. 다시 연결해 주세요.")
    }
    throw new Error("Push 구독을 현재 계정에 저장하지 못했습니다.")
  }

  async function deleteStoredSubscription(
    endpoint: string,
    accessToken: string,
    signal?: AbortSignal,
  ) {
    const response = await runtime.fetch("/api/push-subscriptions", {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({ endpoint }),
      signal,
    })
    const payload = await readJson(response)
    if (
      !response.ok
      || !isRecord(payload)
      || payload.ok !== true
      || typeof payload.deleted !== "boolean"
    ) {
      throw new Error("Push 구독을 해제하지 못했습니다.")
    }
    return payload.deleted
  }

  async function unsubscribeFromBrowser(subscription: DashboardPushSubscriptionLike) {
    const removed = await subscription.unsubscribe()
    if (!removed) throw new Error("브라우저의 Push 구독을 해제하지 못했습니다.")
  }

  async function subscribeWithCurrentKey(registration: DashboardPushRegistrationLike) {
    if (!runtime.publicKey) throw new Error("Push 공개키가 설정되지 않았습니다.")
    return registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(runtime.publicKey),
    })
  }

  async function requestPermissionAndBind(input: DashboardPushAuthContext) {
    const auth = validateAuthContext(input)
    if (
      currentReadiness.profileId !== auth.profileId
      || !["permission_prompt", "subscription_missing"].includes(currentReadiness.state)
    ) {
      throw new Error("Push action은 permission_prompt 또는 subscription_missing 상태에서만 실행할 수 있습니다.")
    }
    const registration = currentRegistration
    const { generation, controller } = beginMutation(auth.profileId)

    let permission: NotificationPermission
    if (currentReadiness.state === "permission_prompt") {
      const permissionRequest = runtime.requestNotificationPermission()
      permission = await permissionRequest
      if (!isCurrent(generation, auth.profileId)) return currentReadiness
    } else {
      permission = runtime.getNotificationPermission()
    }
    if (permission !== "granted") {
      return refresh({ ...auth, reason: "manual" })
    }

    if (!registration) {
      const readiness = await refresh({ ...auth, reason: "manual" })
      if (readiness.state !== "subscription_missing" || !currentRegistration) return readiness
      return requestPermissionAndBind(auth)
    }

    let subscription = await registration.pushManager.getSubscription()
    if (!isCurrent(generation, auth.profileId)) return currentReadiness
    if (subscription && !subscriptionUsesPublicKey(subscription, runtime.publicKey)) {
      throw new Error("기존 Push 공개키가 달라 명시적으로 다시 연결해야 합니다.")
    }
    if (subscription && currentReadiness.state === "subscription_missing") {
      await unsubscribeFromBrowser(subscription)
      if (!isCurrent(generation, auth.profileId)) return currentReadiness
      subscription = null
    }
    subscription = subscription || await subscribeWithCurrentKey(registration)
    if (!isCurrent(generation, auth.profileId)) return currentReadiness
    await persistSubscription(subscription, auth.accessToken, undefined, controller.signal)
    if (!isCurrent(generation, auth.profileId)) return currentReadiness
    return refresh({ ...auth, reason: "manual" })
  }

  async function rebind(input: DashboardPushAuthContext) {
    const { auth, registration } = requireActionState(input, ["subscription_owner_mismatch"])
    const mismatchCode = currentReadiness.code
    const { generation, controller } = beginMutation(auth.profileId)
    let subscription = await registration.pushManager.getSubscription()
    if (!isCurrent(generation, auth.profileId)) return currentReadiness

    const keyMismatch = mismatchCode === "push_public_key_mismatch"
      || Boolean(subscription && !subscriptionUsesPublicKey(subscription, runtime.publicKey))
    if (subscription && keyMismatch) {
      const deleted = await deleteStoredSubscription(
        subscription.endpoint,
        auth.accessToken,
        controller.signal,
      )
      if (!deleted) {
        throw new Error("Push 구독 소유 계정이 변경되어 현재 브라우저에서는 다시 연결하지 않았습니다.")
      }
      if (!isCurrent(generation, auth.profileId)) return currentReadiness
      await unsubscribeFromBrowser(subscription)
      if (!isCurrent(generation, auth.profileId)) return currentReadiness
      subscription = null
    }
    subscription = subscription || await subscribeWithCurrentKey(registration)
    if (!isCurrent(generation, auth.profileId)) return currentReadiness
    await persistSubscription(
      subscription,
      auth.accessToken,
      keyMismatch ? undefined : "rebind",
      controller.signal,
    )
    if (!isCurrent(generation, auth.profileId)) return currentReadiness
    return refresh({ ...auth, reason: "manual" })
  }

  async function sendSelfTest(input: DashboardPushAuthContext) {
    const { auth, registration } = requireActionState(input, ["ready"])
    const { generation, controller } = beginMutation(auth.profileId)
    const subscription = await registration.pushManager.getSubscription()
    if (!isCurrent(generation, auth.profileId)) return currentReadiness
    if (!subscription || !subscriptionUsesPublicKey(subscription, runtime.publicKey)) {
      currentReadiness = createReadiness(
        "subscription_owner_mismatch",
        auth.profileId,
        "push_public_key_mismatch",
      )
      return currentReadiness
    }

    let outcome: DashboardPushSelfTestOutcome = "failed"
    let code = "push_self_test_failed"
    try {
      const response = await runtime.fetch("/api/notifications/push-readiness", {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${auth.accessToken}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
        credentials: "same-origin",
        body: JSON.stringify({
          action: "send_test",
          subscription_endpoint: subscription.endpoint,
        }),
        signal: controller.signal,
      })
      const payload = await readJson(response)
      if (isRecord(payload) && typeof payload.code === "string") code = payload.code
      if (
        isRecord(payload)
        && typeof payload.warningCode === "string"
        && code !== "push_subscription_expired_cleanup_unavailable"
      ) {
        code = payload.warningCode
      }
      if (isRecord(payload) && response.ok && payload.state === "sent") {
        outcome = "sent"
      } else if (isRecord(payload) && (response.status === 410 || payload.state === "expired")) {
        outcome = "expired"
      }
    } catch {
      outcome = "failed"
    }
    if (outcome === "expired") {
      try {
        await unsubscribeFromBrowser(subscription)
      } catch {
        code = "push_expired_subscription_cleanup_failed"
      }
    }
    if (!isCurrent(generation, auth.profileId)) return currentReadiness
    currentReadiness = createReadiness(
      applyDashboardPushSelfTestOutcome("ready", outcome),
      auth.profileId,
      code,
    )
    return currentReadiness
  }

  async function unsubscribe(input: DashboardPushAuthContext) {
    const { auth, registration } = requireActionState(input, [
      "ready",
      "self_test_sent",
      "self_test_expired",
      "self_test_failed",
    ])
    const { generation, controller } = beginMutation(auth.profileId)
    const subscription = await registration.pushManager.getSubscription()
    if (!isCurrent(generation, auth.profileId)) return currentReadiness
    if (!subscription) return refresh({ ...auth, reason: "manual" })

    const deleted = await deleteStoredSubscription(
      subscription.endpoint,
      auth.accessToken,
      controller.signal,
    )
    if (!deleted) {
      throw new Error("Push 구독 소유 계정이 변경되어 현재 브라우저에서는 해제하지 않았습니다.")
    }
    if (!isCurrent(generation, auth.profileId)) return currentReadiness
    await unsubscribeFromBrowser(subscription)
    if (!isCurrent(generation, auth.profileId)) return currentReadiness
    return refresh({ ...auth, reason: "manual" })
  }

  return {
    refresh,
    getCurrent,
    invalidate,
    requestPermissionAndBind,
    rebind,
    sendSelfTest,
    unsubscribe,
  }
}

export function attachDashboardPushRefreshListeners(
  onRefresh: (reason: "focus" | "visibility") => void,
  sources: RefreshListenerSources = {
    windowTarget: window,
    documentTarget: document,
    getVisibilityState: () => document.visibilityState,
  },
) {
  const handleFocus = () => onRefresh("focus")
  const handleVisibilityChange = () => {
    if (sources.getVisibilityState() === "visible") onRefresh("visibility")
  }
  sources.windowTarget.addEventListener("focus", handleFocus)
  sources.documentTarget.addEventListener("visibilitychange", handleVisibilityChange)
  return () => {
    sources.windowTarget.removeEventListener("focus", handleFocus)
    sources.documentTarget.removeEventListener("visibilitychange", handleVisibilityChange)
  }
}

const dashboardPushClient = createDashboardPushClient(productionRuntime())

export function refreshDashboardPushReadiness(input: DashboardPushRefreshInput) {
  return dashboardPushClient.refresh(input)
}

export function getCurrentDashboardPushReadiness() {
  return dashboardPushClient.getCurrent()
}

export function invalidateDashboardPushReadiness(profileId = "") {
  return dashboardPushClient.invalidate(profileId)
}

export function requestDashboardPushPermissionAndBind(input: DashboardPushAuthContext) {
  return dashboardPushClient.requestPermissionAndBind(input)
}

export function rebindDashboardPushSubscription(input: DashboardPushAuthContext) {
  return dashboardPushClient.rebind(input)
}

export function sendDashboardPushSelfTest(input: DashboardPushAuthContext) {
  return dashboardPushClient.sendSelfTest(input)
}

export function unsubscribeDashboardPush(input: DashboardPushAuthContext) {
  return dashboardPushClient.unsubscribe(input)
}
