// Ordering changes the page, but not the general-task aggregate. Keep a valid
// sort in the RPC payload; unknown values must retain their validation boundary.
export function getOpsTaskPageStatsScope(filters: Readonly<{ taskType: string; sort?: unknown }>): string {
  const generalOrder = filters.taskType === "general"
    && (filters.sort === "due" || filters.sort === "priority" || filters.sort === "status")
  return JSON.stringify(generalOrder ? { ...filters, sort: "due" } : filters)
}

type StatsCacheOptions = Readonly<{
  now?: () => number
  ttlMs: number
}>

type CachedValue<T> = Readonly<{
  value: T
  expiresAt: number
}>

type PendingRequest<T> = Readonly<{
  request: Promise<T>
  signal?: AbortSignal
}>

export function createOpsTaskPageStatsCache<T>({
  now = () => Date.now(),
  ttlMs,
}: StatsCacheOptions) {
  const values = new Map<string, CachedValue<T>>()
  const inFlight = new Map<string, PendingRequest<T>>()
  let generation = 0

  async function load(key: string, loader: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const cached = values.get(key)
    if (cached && cached.expiresAt > now()) return cached.value

    const pending = inFlight.get(key)
    if (pending && pending.signal === signal && !signal?.aborted) return pending.request

    const requestGeneration = generation
    const request = loader()
    const entry = { request, signal }
    inFlight.set(key, entry)
    try {
      const value = await request
      if (value !== undefined && !signal?.aborted && requestGeneration === generation && inFlight.get(key) === entry) {
        values.set(key, { value, expiresAt: now() + ttlMs })
      }
      return value
    } finally {
      if (inFlight.get(key) === entry) inFlight.delete(key)
    }
  }

  return {
    load,
    clear: () => {
      generation += 1
      values.clear()
      inFlight.clear()
    },
  }
}
