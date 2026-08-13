import {
  DASHBOARD_STATISTICS_CONTRACT_VERSION,
  dashboardStatisticsQuery,
  normalizeDashboardStatisticsSnapshot,
  type DashboardStatisticsRequest,
  type DashboardStatisticsSnapshot,
} from "./statistics-contract.ts"

const DASHBOARD_STATISTICS_TTL_MS = 600_000

export function buildDashboardStatisticsCacheKey(input: Readonly<{
  userId: string
  role: string
  tab: string
  subject: string
  division: string
  dateFrom: string
  dateTo: string
}>) {
  return [
    input.userId,
    input.role,
    DASHBOARD_STATISTICS_CONTRACT_VERSION,
    input.tab,
    input.subject,
    input.division,
    input.dateFrom,
    input.dateTo,
  ].join(":")
}

type MemoryEntry = {
  generation: number
  promise?: Promise<DashboardStatisticsSnapshot>
  value?: DashboardStatisticsSnapshot
  expiresAt?: number
}

export function createDashboardStatisticsMemoryCache({
  now = () => Date.now(),
  ttlMs = DASHBOARD_STATISTICS_TTL_MS,
} = {}) {
  const entries = new Map<string, MemoryEntry>()
  const generations = new Map<string, number>()

  function generation(key: string) {
    return generations.get(key) ?? 0
  }

  function invalidate(key: string) {
    generations.set(key, generation(key) + 1)
    entries.delete(key)
  }

  function load(
    key: string,
    loader: () => Promise<DashboardStatisticsSnapshot>,
    options: { force?: boolean } = {},
  ) {
    if (options.force) invalidate(key)
    const requestGeneration = generation(key)
    const current = entries.get(key)
    if (current?.value && (current.expiresAt ?? 0) > now()) return Promise.resolve(current.value)
    if (current?.promise && current.generation === requestGeneration) return current.promise

    let loadResult: Promise<DashboardStatisticsSnapshot>
    try {
      loadResult = loader()
    } catch (error) {
      loadResult = Promise.reject(error)
    }
    const promise = Promise.resolve(loadResult).then((value) => {
      if (
        generation(key) === requestGeneration &&
        entries.get(key)?.promise === promise
      ) {
        entries.set(key, {
          generation: requestGeneration,
          value,
          expiresAt: now() + ttlMs,
        })
      }
      return value
    }).catch((error) => {
      if (entries.get(key)?.promise === promise) entries.delete(key)
      throw error
    })
    entries.set(key, { generation: requestGeneration, promise })
    return promise
  }

  return { load, invalidate }
}

export const dashboardStatisticsMemoryCache = createDashboardStatisticsMemoryCache()

export function loadActiveDashboardStatisticsSnapshot(input: Readonly<{
  active: boolean
  cache: ReturnType<typeof createDashboardStatisticsMemoryCache>
  key: string
  loader: () => Promise<DashboardStatisticsSnapshot>
  force?: boolean
}>) {
  if (!input.active) return Promise.resolve(null)
  return input.cache.load(input.key, input.loader, { force: input.force })
}

export async function fetchDashboardStatisticsSnapshot(input: Readonly<{
  accessToken: string
  request: DashboardStatisticsRequest
  signal: AbortSignal
  refresh?: boolean
  fetcher?: typeof fetch
}>) {
  if (!input.accessToken.trim()) throw new Error("dashboard_statistics_unauthorized")
  const fetcher = input.fetcher ?? fetch
  const response = await fetcher(
    `/api/dashboard/statistics?${dashboardStatisticsQuery(input.request, input.refresh)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${input.accessToken}` },
      signal: input.signal,
      cache: "no-store",
    },
  )
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const code = body && typeof body === "object" && "error" in body
      ? String((body as { error: unknown }).error)
      : "dashboard_statistics_unavailable"
    throw Object.assign(new Error(code), { status: response.status, code })
  }
  return normalizeDashboardStatisticsSnapshot(body)
}
