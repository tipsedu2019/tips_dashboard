type StatsCacheOptions = Readonly<{
  now?: () => number
  ttlMs: number
}>

type CachedValue<T> = Readonly<{
  value: T
  expiresAt: number
}>

export function createOpsTaskPageStatsCache<T>({
  now = () => Date.now(),
  ttlMs,
}: StatsCacheOptions) {
  const values = new Map<string, CachedValue<T>>()
  const inFlight = new Map<string, Promise<T>>()

  async function load(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = values.get(key)
    if (cached && cached.expiresAt > now()) return cached.value

    const pending = inFlight.get(key)
    if (pending) return pending

    const request = loader()
    inFlight.set(key, request)
    try {
      const value = await request
      if (value !== undefined) {
        values.set(key, { value, expiresAt: now() + ttlMs })
      }
      return value
    } finally {
      if (inFlight.get(key) === request) inFlight.delete(key)
    }
  }

  return {
    load,
    clear: () => values.clear(),
  }
}
