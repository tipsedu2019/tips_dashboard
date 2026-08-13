import { createHash } from "node:crypto"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import {
  DASHBOARD_STATISTICS_CONTRACT_VERSION,
  parseDashboardStatisticsRequest,
  type DashboardStatisticsCacheStatus,
  type DashboardStatisticsRequest,
} from "../statistics-contract.ts"
import { buildDashboardStatisticsCacheKey } from "../statistics-cache.ts"

type ReadyCacheResult = Readonly<{
  status: "ready"
  generation: number
  payload: unknown
  generatedAt: string
  expiresAt: string
}>

type CacheScope = DashboardStatisticsRequest & Readonly<{
  actorProfileId: string
  role: string
  contractVersion: typeof DASHBOARD_STATISTICS_CONTRACT_VERSION
  requestHash: string
}>

type StatisticsCache = Readonly<{
  claim(input: CacheScope & { force: boolean }): Promise<
    | ReadyCacheResult
    | { status: "wait"; generation: number; leaseExpiresAt: string }
    | { status: "acquired"; generation: number; claimToken: string; leaseExpiresAt: string }
  >
  read(input: CacheScope): Promise<ReadyCacheResult | { status: "miss" }>
  finalize(input: CacheScope & {
    generation: number
    claimToken: string
    payload: unknown
  }): Promise<
    | { status: "stored"; generatedAt: string; expiresAt: string }
    | { status: "superseded" }
  >
  invalidate(input: CacheScope & { expectedGeneration: number }): Promise<
    | { status: "invalidated"; generation: number }
    | { status: "stale" }
  >
}>

type AuthContext = Readonly<{
  actorProfileId: string
  role: string
  actorClient: unknown
}>

type RouteDependencies = Readonly<{
  authenticate(request: Request): Promise<AuthContext>
  cache: StatisticsCache
  calculate(input: {
    actorClient: unknown
    request: DashboardStatisticsRequest
  }): Promise<unknown>
  sleep?(milliseconds: number): Promise<void>
}>

type HttpError = Error & { status?: number; code?: string }

const WAIT_DELAYS_MS = [100, 250, 500] as const

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      ...headers,
    },
  })
}

function success(
  request: DashboardStatisticsRequest,
  ready: Pick<ReadyCacheResult, "payload" | "generatedAt" | "expiresAt">,
  cacheStatus: DashboardStatisticsCacheStatus,
) {
  return json({
    ok: true,
    contractVersion: DASHBOARD_STATISTICS_CONTRACT_VERSION,
    tab: request.tab,
    data: ready.payload,
    generatedAt: ready.generatedAt,
    expiresAt: ready.expiresAt,
    cacheStatus,
  })
}

function failure(error: unknown) {
  const candidate = error as HttpError
  const status = Number.isInteger(candidate?.status) ? candidate.status! : 503
  const code = typeof candidate?.code === "string"
    ? candidate.code
    : status === 401
      ? "dashboard_statistics_unauthorized"
      : status === 403
        ? "dashboard_statistics_forbidden"
        : "dashboard_statistics_unavailable"
  return json({ ok: false, error: code }, status)
}

function scopeFor(context: AuthContext, request: DashboardStatisticsRequest): CacheScope {
  const cacheKey = buildDashboardStatisticsCacheKey({
    userId: context.actorProfileId,
    role: context.role,
    ...request,
  })
  return {
    actorProfileId: context.actorProfileId,
    role: context.role,
    contractVersion: DASHBOARD_STATISTICS_CONTRACT_VERSION,
    requestHash: createHash("sha256").update(cacheKey).digest("hex"),
    ...request,
  }
}

async function readAfterWait(
  cache: StatisticsCache,
  scope: CacheScope,
  sleep: (milliseconds: number) => Promise<void>,
) {
  for (const delay of WAIT_DELAYS_MS) {
    await sleep(delay)
    const result = await cache.read(scope)
    if (result.status === "ready") return result
  }
  return null
}

export function createDashboardStatisticsRouteHandler(dependencies: RouteDependencies) {
  const sleep = dependencies.sleep ?? (
    (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
  )

  return async function get(request: Request) {
    const url = new URL(request.url)
    const parsed = parseDashboardStatisticsRequest(url.searchParams)
    if (!parsed) return json({ ok: false, error: "dashboard_statistics_request_invalid" }, 400)

    let context: AuthContext
    try {
      context = await dependencies.authenticate(request)
      if (!context.actorProfileId || !context.role || !context.actorClient) {
        throw Object.assign(new Error("dashboard statistics auth invalid"), {
          status: 401,
          code: "dashboard_statistics_unauthorized",
        })
      }
    } catch (error) {
      return failure(error)
    }

    const scope = scopeFor(context, parsed.request)
    let claim
    try {
      claim = await dependencies.cache.claim({ ...scope, force: parsed.refresh })
    } catch {
      return json({ ok: false, error: "statistics_cache_unavailable" }, 503)
    }

    if (claim.status === "ready") return success(parsed.request, claim, "hit")
    if (claim.status === "wait") {
      try {
        const ready = await readAfterWait(dependencies.cache, scope, sleep)
        if (ready) return success(parsed.request, ready, "hit")
      } catch {
        return json({ ok: false, error: "statistics_cache_unavailable" }, 503)
      }
      return json(
        { ok: false, error: "statistics_cache_busy" },
        503,
        { "Retry-After": "1" },
      )
    }

    let payload: unknown
    try {
      payload = await dependencies.calculate({
        actorClient: context.actorClient,
        request: parsed.request,
      })
    } catch {
      await dependencies.cache.invalidate({
        ...scope,
        expectedGeneration: claim.generation,
      }).catch(() => undefined)
      return json({ ok: false, error: "dashboard_statistics_unavailable" }, 503)
    }

    try {
      const finalized = await dependencies.cache.finalize({
        ...scope,
        generation: claim.generation,
        claimToken: claim.claimToken,
        payload,
      })
      if (finalized.status === "stored") {
        return success(
          parsed.request,
          { payload, generatedAt: finalized.generatedAt, expiresAt: finalized.expiresAt },
          parsed.refresh ? "refreshed" : "miss",
        )
      }

      const current = await dependencies.cache.read(scope)
      if (current.status === "ready") return success(parsed.request, current, "hit")
      const ready = await readAfterWait(dependencies.cache, scope, sleep)
      if (ready) return success(parsed.request, ready, "hit")
      return json(
        { ok: false, error: "statistics_cache_busy" },
        503,
        { "Retry-After": "1" },
      )
    } catch {
      return json({ ok: false, error: "statistics_cache_unavailable" }, 503)
    }
  }
}

function environment(name: string) {
  return typeof process.env[name] === "string" ? process.env[name]!.trim() : ""
}

function bearer(request: Request) {
  return /^Bearer ([^\s]+)$/iu.exec(request.headers.get("authorization") ?? "")?.[1] ?? ""
}

function createAuthenticatedClient(token: string) {
  const url = environment("NEXT_PUBLIC_SUPABASE_URL") || environment("VITE_SUPABASE_URL")
  const key = environment("NEXT_PUBLIC_SUPABASE_ANON_KEY") || environment("VITE_SUPABASE_ANON_KEY")
  if (!url || !key) throw new Error("dashboard statistics auth configuration unavailable")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

function createCacheServiceClient() {
  const url = environment("NEXT_PUBLIC_SUPABASE_URL") || environment("VITE_SUPABASE_URL")
  const key = environment("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !key) throw new Error("dashboard statistics cache configuration unavailable")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function rpc(
  client: SupabaseClient,
  name: string,
  parameters: Record<string, unknown> = {},
) {
  const result = await client
    .rpc(name, parameters)
    .abortSignal(AbortSignal.timeout(8_000))
    .retry(false)
  if (result.error) throw result.error
  return result.data
}

function object(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("dashboard statistics cache response invalid")
  }
  return value as Record<string, unknown>
}

function text(value: unknown) {
  if (typeof value !== "string" || !value) throw new Error("dashboard statistics cache response invalid")
  return value
}

function generation(value: unknown) {
  const parsed = typeof value === "string" ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 1) {
    throw new Error("dashboard statistics cache response invalid")
  }
  return Number(parsed)
}

function readyResult(value: Record<string, unknown>): ReadyCacheResult {
  return {
    status: "ready",
    generation: generation(value.generation),
    payload: value.payload,
    generatedAt: text(value.generated_at),
    expiresAt: text(value.expires_at),
  }
}

function cacheParameters(scope: CacheScope) {
  return {
    p_actor_profile_id: scope.actorProfileId,
    p_role: scope.role,
    p_request_hash: scope.requestHash,
    p_contract_version: scope.contractVersion,
  }
}

function createProductionCache(cacheServiceClient: SupabaseClient): StatisticsCache {
  return {
    async read(scope) {
      const value = object(await rpc(
        cacheServiceClient,
        "read_dashboard_statistics_cache_v1",
        cacheParameters(scope),
      ))
      return value.status === "miss" ? { status: "miss" } : readyResult(value)
    },
    async claim(scope) {
      const value = object(await rpc(
        cacheServiceClient,
        "claim_dashboard_statistics_cache_v1",
        {
          ...cacheParameters(scope),
          p_tab: scope.tab,
          p_force: scope.force,
        },
      ))
      if (value.status === "ready") return readyResult(value)
      if (value.status === "wait") {
        return {
          status: "wait",
          generation: generation(value.generation),
          leaseExpiresAt: text(value.lease_expires_at),
        }
      }
      if (value.status !== "acquired") throw new Error("dashboard statistics cache response invalid")
      return {
        status: "acquired",
        generation: generation(value.generation),
        claimToken: text(value.claim_token),
        leaseExpiresAt: text(value.lease_expires_at),
      }
    },
    async finalize(scope) {
      const value = object(await rpc(
        cacheServiceClient,
        "finalize_dashboard_statistics_cache_v1",
        {
          ...cacheParameters(scope),
          p_generation: scope.generation,
          p_claim_token: scope.claimToken,
          p_payload: scope.payload,
        },
      ))
      if (value.status === "superseded") return { status: "superseded" }
      if (value.status !== "stored") throw new Error("dashboard statistics cache response invalid")
      return {
        status: "stored",
        generatedAt: text(value.generated_at),
        expiresAt: text(value.expires_at),
      }
    },
    async invalidate(scope) {
      const value = object(await rpc(
        cacheServiceClient,
        "invalidate_dashboard_statistics_cache_v1",
        {
          ...cacheParameters(scope),
          p_expected_generation: scope.expectedGeneration,
        },
      ))
      if (value.status === "stale") return { status: "stale" }
      if (value.status !== "invalidated") throw new Error("dashboard statistics cache response invalid")
      return { status: "invalidated", generation: generation(value.generation) }
    },
  }
}

export function createProductionDashboardStatisticsRouteHandler() {
  const cacheServiceClient = createCacheServiceClient()
  return createDashboardStatisticsRouteHandler({
    async authenticate(request) {
      const token = bearer(request)
      if (!token) {
        throw Object.assign(new Error("dashboard statistics unauthorized"), {
          status: 401,
          code: "dashboard_statistics_unauthorized",
        })
      }
      const actorClient = createAuthenticatedClient(token)
      const userResult = await actorClient.auth.getUser(token)
      const actorProfileId = userResult.data.user?.id ?? ""
      if (userResult.error || !actorProfileId) {
        throw Object.assign(new Error("dashboard statistics unauthorized"), {
          status: 401,
          code: "dashboard_statistics_unauthorized",
        })
      }
      const role = await rpc(actorClient, "current_dashboard_role")
      if (typeof role !== "string" || !role.trim()) {
        throw Object.assign(new Error("dashboard statistics forbidden"), {
          status: 403,
          code: "dashboard_statistics_forbidden",
        })
      }
      return { actorProfileId, role, actorClient }
    },
    cache: createProductionCache(cacheServiceClient),
    async calculate({ actorClient, request }) {
      const query = (actorClient as SupabaseClient)
        .rpc("get_dashboard_statistics_sources_v1", {
          p_tab: request.tab,
          p_subject: request.subject || null,
          p_division: request.division || null,
          p_date_from: request.dateFrom || null,
          p_date_to: request.dateTo || null,
        })
      const result = await query
        .abortSignal(AbortSignal.timeout(8_000))
        .retry(false)
      if (result.error) throw result.error
      return result.data
    },
  })
}
