import { createECDH } from "node:crypto"
import { constants as fsConstants } from "node:fs"
import { access } from "node:fs/promises"
import { join } from "node:path"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import webpush from "web-push"

import {
  authenticateNotificationRequest,
  type NotificationAuthenticatedClient,
} from "./notification-auth.ts"
import { validateWebPushEndpoint } from "./web-push-endpoint.ts"

export const PUSH_READINESS_STATES = [
  "server_unconfigured",
  "asset_missing",
  "subscription_missing",
  "subscription_owner_mismatch",
  "ready",
] as const

export type PushReadinessState = typeof PUSH_READINESS_STATES[number]

const PUSH_READINESS_STATE_SET = new Set<string>(PUSH_READINESS_STATES)
const SAFE_ERROR_STATUS = {
  notification_unauthorized: 401,
  notification_forbidden: 403,
  notification_auth_unavailable: 503,
  push_readiness_invalid_request: 400,
  push_readiness_unavailable: 503,
  push_readiness_unsafe_response: 502,
  push_self_test_unavailable: 502,
} as const
const HTTPS_ENDPOINT_MAX_LENGTH = 4_096
const FIXED_SELF_TEST_TITLE = "TIPS Dashboard 테스트 알림"
const FIXED_SELF_TEST_BODY = "현재 브라우저의 푸시 알림 연결이 정상입니다."
const FIXED_SELF_TEST_HREF = "/admin/settings/notifications"

type AuthContext = Readonly<{
  userId: string
  role: string
  client?: unknown
}>

type PushReadinessInspection = Readonly<{
  state: unknown
  publicKeyConfigured: unknown
  privateKeyConfigured: unknown
  keysMatch: unknown
  contactConfigured: unknown
  assetsAvailable: unknown
  subscriptionOwned: unknown
  capability: unknown
}> & Record<string, unknown>

type PushSelfTestInput = Readonly<{
  userId: string
  endpoint: string
  title: string
  body: string
  href: string
}>

type PushSelfTestResult = Readonly<{
  accepted?: unknown
  outcome?: unknown
  code?: unknown
}> & Record<string, unknown>

type NormalizedPushSelfTestResult = Readonly<{
  outcome: "sent" | "expired" | "failed"
  code: "push_self_test_sent" | "push_subscription_expired" | "push_self_test_failed"
}>

type PushReadinessRouteDependencies = Readonly<{
  authenticate(request: Request): Promise<AuthContext>
  inspectReadiness(input: {
    userId: string
    endpoint: string | null
  }): Promise<PushReadinessInspection>
  sendSelfTest(input: PushSelfTestInput): Promise<PushSelfTestResult>
  recordSelfTestAudit(input: Readonly<{
    userId: string
    outcome: NormalizedPushSelfTestResult["outcome"]
    code: NormalizedPushSelfTestResult["code"]
  }>): Promise<void>
}>

type StructuredError = Error & {
  status?: number
  code?: string
}

type PushSubscriptionRow = Readonly<{
  profile_id?: unknown
  endpoint?: unknown
  p256dh?: unknown
  auth?: unknown
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index])
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  })
}

function invalidRequest() {
  return json({ ok: false, code: "push_readiness_invalid_request" }, 400)
}

function normalizedError(error: unknown) {
  const structured = error as StructuredError
  const requestedCode = typeof structured?.code === "string" ? structured.code : ""
  const code = Object.prototype.hasOwnProperty.call(SAFE_ERROR_STATUS, requestedCode)
    ? requestedCode
    : "push_readiness_unavailable"
  const status = SAFE_ERROR_STATUS[code as keyof typeof SAFE_ERROR_STATUS]
  return json({ ok: false, code }, status)
}

function safeHttpsEndpoint(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > HTTPS_ENDPOINT_MAX_LENGTH) {
    return null
  }
  if (value.trim() !== value) return null

  try {
    return validateWebPushEndpoint(value)
  } catch {
    return null
  }
}

function readExactEndpointQuery(request: Request): string | null | undefined {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return undefined
  }

  const keys = [...url.searchParams.keys()]
  if (
    keys.some((key) => key !== "subscription_endpoint")
    || url.searchParams.getAll("subscription_endpoint").length > 1
  ) {
    return undefined
  }
  if (!url.searchParams.has("subscription_endpoint")) return null
  return safeHttpsEndpoint(url.searchParams.get("subscription_endpoint")) || undefined
}

function safeInspection(value: PushReadinessInspection) {
  if (
    !isRecord(value)
    || typeof value.state !== "string"
    || !PUSH_READINESS_STATE_SET.has(value.state)
    || typeof value.publicKeyConfigured !== "boolean"
    || typeof value.privateKeyConfigured !== "boolean"
    || typeof value.keysMatch !== "boolean"
    || typeof value.contactConfigured !== "boolean"
    || typeof value.assetsAvailable !== "boolean"
    || typeof value.subscriptionOwned !== "boolean"
    || typeof value.capability !== "boolean"
    || (value.capability && !(
      value.publicKeyConfigured
      && value.privateKeyConfigured
      && value.keysMatch
      && value.contactConfigured
      && value.assetsAvailable
    ))
    || (value.state === "server_unconfigured" && value.capability)
    || (value.state === "asset_missing" && (value.capability || value.assetsAvailable))
    || (value.state === "subscription_missing" && (!value.capability || value.subscriptionOwned))
    || (value.state === "subscription_owner_mismatch" && !value.capability)
    || (value.state === "ready" && !(value.capability && value.subscriptionOwned))
    || (value.state === "subscription_owner_mismatch" && value.subscriptionOwned)
  ) {
    const error = new Error("안전하지 않은 Push 준비 상태 응답") as StructuredError
    error.status = 502
    error.code = "push_readiness_unsafe_response"
    throw error
  }

  return {
    ok: true,
    state: value.state as PushReadinessState,
    publicKeyConfigured: value.publicKeyConfigured,
    privateKeyConfigured: value.privateKeyConfigured,
    keysMatch: value.keysMatch,
    contactConfigured: value.contactConfigured,
    assetsAvailable: value.assetsAvailable,
    subscriptionOwned: value.subscriptionOwned,
    capability: value.capability,
  }
}

function normalizeSelfTestResult(result: PushSelfTestResult): NormalizedPushSelfTestResult {
  const outcome = result.accepted === true
    ? "sent"
    : result.outcome === "expired"
      ? "expired"
      : "failed"

  if (outcome === "sent") {
    return { outcome: "sent", code: "push_self_test_sent" }
  }
  if (outcome === "expired") {
    return { outcome: "expired", code: "push_subscription_expired" }
  }
  return { outcome: "failed", code: "push_self_test_failed" }
}

function selfTestResponse(result: NormalizedPushSelfTestResult) {
  if (result.outcome === "sent") {
    return json({ ok: true, state: result.outcome, code: result.code })
  }
  if (result.outcome === "expired") {
    return json({ ok: false, state: result.outcome, code: result.code }, 410)
  }
  return json({ ok: false, state: result.outcome, code: result.code }, 502)
}

export function createPushReadinessRouteHandlers(
  dependencies: PushReadinessRouteDependencies,
) {
  return {
    async get(request: Request) {
      try {
        const endpoint = readExactEndpointQuery(request)
        if (endpoint === undefined) return invalidRequest()

        const context = await dependencies.authenticate(request)
        const inspection = await dependencies.inspectReadiness({
          userId: context.userId,
          endpoint,
        })
        return json(safeInspection(inspection))
      } catch (error) {
        return normalizedError(error)
      }
    },

    async post(request: Request) {
      try {
        const context = await dependencies.authenticate(request)
        const body = await request.json().catch(() => null)
        if (!isRecord(body) || !exactKeys(body, ["action", "subscription_endpoint"])) {
          return invalidRequest()
        }
        if (body.action !== "send_test") return invalidRequest()

        const endpoint = safeHttpsEndpoint(body.subscription_endpoint)
        if (!endpoint) return invalidRequest()

        const readiness = safeInspection(await dependencies.inspectReadiness({
          userId: context.userId,
          endpoint,
        }))
        if (readiness.state !== "ready" || !readiness.subscriptionOwned) {
          return json({
            ok: false,
            state: readiness.state,
            code: `push_${readiness.state}`,
          }, 409)
        }

        let result: PushSelfTestResult
        try {
          result = await dependencies.sendSelfTest({
            userId: context.userId,
            endpoint,
            title: FIXED_SELF_TEST_TITLE,
            body: FIXED_SELF_TEST_BODY,
            href: FIXED_SELF_TEST_HREF,
          })
        } catch {
          result = { accepted: false, outcome: "failed", code: "push_self_test_failed" }
        }
        const normalizedResult = normalizeSelfTestResult(result)
        try {
          await dependencies.recordSelfTestAudit({
            userId: context.userId,
            outcome: normalizedResult.outcome,
            code: normalizedResult.code,
          })
        } catch {
          return json({
            ok: false,
            state: "failed",
            code: "push_self_test_audit_unavailable",
          }, 502)
        }
        return selfTestResponse(normalizedResult)
      } catch (error) {
        return normalizedError(error)
      }
    },
  }
}

function environmentText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function readPushEnvironment() {
  return {
    supabaseUrl: environmentText(
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    ),
    supabaseAnonKey: environmentText(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
    ),
    serviceRoleKey: environmentText(process.env.SUPABASE_SERVICE_ROLE_KEY),
    publicKey: environmentText(
      process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    ),
    privateKey: environmentText(
      process.env.WEB_PUSH_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY,
    ),
    contact: environmentText(process.env.WEB_PUSH_CONTACT),
  }
}

function vapidKeysMatch(publicKey: string, privateKey: string) {
  if (!publicKey || !privateKey) return false
  try {
    const curve = createECDH("prime256v1")
    curve.setPrivateKey(Buffer.from(privateKey, "base64url"))
    return curve.getPublicKey().toString("base64url") === publicKey
  } catch {
    return false
  }
}

function contactIsConfigured(contact: string) {
  if (!contact) return false
  try {
    const parsed = new URL(contact)
    return parsed.protocol === "mailto:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

async function pushAssetsAvailable() {
  try {
    await Promise.all([
      access(join(process.cwd(), "public", "sw.js"), fsConstants.R_OK),
      access(join(process.cwd(), "public", "manifest.webmanifest"), fsConstants.R_OK),
    ])
    return true
  } catch {
    return false
  }
}

function createAuthenticatedClient(token: string): NotificationAuthenticatedClient {
  const environment = readPushEnvironment()
  if (!environment.supabaseUrl || !environment.supabaseAnonKey) {
    throw new Error("Push 인증 환경이 설정되지 않았습니다.")
  }
  return createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  }) as unknown as NotificationAuthenticatedClient
}

function createServiceClient(): SupabaseClient | null {
  const environment = readPushEnvironment()
  if (!environment.supabaseUrl || !environment.serviceRoleKey) return null
  return createClient(environment.supabaseUrl, environment.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function inspectProductionReadiness(input: {
  userId: string
  endpoint: string | null
}): Promise<PushReadinessInspection> {
  const environment = readPushEnvironment()
  const publicKeyConfigured = Boolean(environment.publicKey)
  const privateKeyConfigured = Boolean(environment.privateKey)
  const keysMatch = vapidKeysMatch(environment.publicKey, environment.privateKey)
  const contactConfigured = contactIsConfigured(environment.contact)
  const assetsAvailable = await pushAssetsAvailable()
  const serviceClient = createServiceClient()

  let subscriptionOwnerId: string | null = null
  let databaseAvailable = Boolean(serviceClient)
  if (serviceClient) {
    if (input.endpoint) {
      const { data, error } = await serviceClient
        .from("dashboard_push_subscriptions")
        .select("profile_id")
        .eq("endpoint", input.endpoint)
        .maybeSingle()
      if (error) {
        databaseAvailable = false
      } else {
        subscriptionOwnerId = typeof data?.profile_id === "string" ? data.profile_id : null
      }
    } else {
      const { error } = await serviceClient
        .from("dashboard_push_subscriptions")
        .select("profile_id")
        .limit(1)
      if (error) databaseAvailable = false
    }
  }

  const subscriptionOwned = subscriptionOwnerId === input.userId
  const serverConfigured = Boolean(
    publicKeyConfigured
    && privateKeyConfigured
    && keysMatch
    && contactConfigured
    && databaseAvailable,
  )
  const capability = serverConfigured && assetsAvailable

  let state: PushReadinessState
  if (!serverConfigured) {
    state = "server_unconfigured"
  } else if (!assetsAvailable) {
    state = "asset_missing"
  } else if (!input.endpoint || !subscriptionOwnerId) {
    state = "subscription_missing"
  } else if (!subscriptionOwned) {
    state = "subscription_owner_mismatch"
  } else {
    state = "ready"
  }

  return {
    state,
    publicKeyConfigured,
    privateKeyConfigured,
    keysMatch,
    contactConfigured,
    assetsAvailable,
    subscriptionOwned,
    capability,
  }
}

async function sendProductionSelfTest(input: PushSelfTestInput): Promise<PushSelfTestResult> {
  const environment = readPushEnvironment()
  const serviceClient = createServiceClient()
  if (
    !serviceClient
    || !vapidKeysMatch(environment.publicKey, environment.privateKey)
    || !contactIsConfigured(environment.contact)
  ) {
    return { accepted: false, outcome: "failed", code: "push_server_unconfigured" }
  }

  const { data, error } = await serviceClient
    .from("dashboard_push_subscriptions")
    .select("profile_id,endpoint,p256dh,auth")
    .eq("profile_id", input.userId)
    .eq("endpoint", input.endpoint)
    .maybeSingle()
  const subscription = (data || null) as PushSubscriptionRow | null
  if (error || !subscription || subscription.profile_id !== input.userId) {
    return { accepted: false, outcome: "failed", code: "push_subscription_owner_mismatch" }
  }

  const endpoint = safeHttpsEndpoint(subscription.endpoint)
  const p256dh = environmentText(subscription.p256dh)
  const auth = environmentText(subscription.auth)
  if (!endpoint || !p256dh || !auth) {
    return { accepted: false, outcome: "failed", code: "push_subscription_invalid" }
  }

  const payload = JSON.stringify({
    title: FIXED_SELF_TEST_TITLE,
    body: FIXED_SELF_TEST_BODY,
    href: FIXED_SELF_TEST_HREF,
    icon: "/favicon-window.png",
    badge: "/favicon-window.png",
    tag: "tips-dashboard-self-test",
  })

  try {
    await webpush.sendNotification({
      endpoint,
      keys: { p256dh, auth },
    }, payload, {
      TTL: 60,
      timeout: 10_000,
      vapidDetails: {
        subject: environment.contact,
        publicKey: environment.publicKey,
        privateKey: environment.privateKey,
      },
    })
    return { accepted: true, outcome: "sent", code: "push_self_test_sent" }
  } catch (error) {
    const statusCode = (error as { statusCode?: unknown })?.statusCode
    if (statusCode === 404 || statusCode === 410) {
      await serviceClient
        .from("dashboard_push_subscriptions")
        .delete()
        .eq("profile_id", input.userId)
        .eq("endpoint", endpoint)
      return { accepted: false, outcome: "expired", code: "push_subscription_expired" }
    }
    return { accepted: false, outcome: "failed", code: "push_self_test_failed" }
  }
}

async function recordProductionSelfTestAudit(input: {
  userId: string
  outcome: NormalizedPushSelfTestResult["outcome"]
  code: NormalizedPushSelfTestResult["code"]
}) {
  const serviceClient = createServiceClient()
  if (!serviceClient) throw new Error("Push 감사 저장소가 설정되지 않았습니다.")
  const { error } = await serviceClient.rpc("record_push_connection_test_audit_v1", {
    p_profile_id: input.userId,
    p_outcome: input.outcome,
    p_code: input.code,
  })
  if (error) throw new Error("Push 감사 기록에 실패했습니다.")
}

export function createProductionPushReadinessRouteHandlers() {
  return createPushReadinessRouteHandlers({
    authenticate: (request) => authenticateNotificationRequest(request, {
      createAuthenticatedClient,
    }),
    inspectReadiness: inspectProductionReadiness,
    sendSelfTest: sendProductionSelfTest,
    recordSelfTestAudit: recordProductionSelfTestAudit,
  })
}
