export const DASHBOARD_SNAPSHOT_VERSION = "dashboard-snapshot-v1"

const DEFAULT_DASHBOARD_SNAPSHOT_TTL_MS = 30_000

export function createDashboardSnapshotCache({
  ttlMs = DEFAULT_DASHBOARD_SNAPSHOT_TTL_MS,
  now = () => Date.now(),
} = {}) {
  const entries = new Map()
  const generations = new Map()

  function keyOf(scope, kind) {
    return `${scope}:${kind}`
  }

  function currentGeneration(key) {
    return generations.get(key) || 0
  }

  function invalidateKey(key) {
    generations.set(key, currentGeneration(key) + 1)
    entries.delete(key)
  }

  function invalidate(scope, kind) {
    if (kind) {
      invalidateKey(keyOf(scope, kind))
      return
    }

    const prefix = `${scope}:`
    const keys = new Set([...entries.keys(), ...generations.keys()])
    for (const key of keys) {
      if (key.startsWith(prefix)) invalidateKey(key)
    }
  }

  function load(scope, kind, loader, { force = false } = {}) {
    const key = keyOf(scope, kind)
    if (force) invalidateKey(key)

    const generation = currentGeneration(key)
    const current = entries.get(key)
    if (current?.hasValue && current.expiresAt > now()) {
      return Promise.resolve(current.value)
    }
    if (current?.inFlight && current.generation === generation) {
      return current.inFlight
    }

    let loadResult
    try {
      loadResult = loader()
    } catch (error) {
      loadResult = Promise.reject(error)
    }

    const inFlight = Promise.resolve(loadResult)
      .then((value) => {
        if (
          currentGeneration(key) === generation
          && entries.get(key)?.inFlight === inFlight
        ) {
          entries.set(key, {
            generation,
            hasValue: true,
            value,
            expiresAt: now() + ttlMs,
          })
        }
        return value
      })
      .catch((error) => {
        if (entries.get(key)?.inFlight === inFlight) entries.delete(key)
        throw error
      })

    entries.set(key, { generation, inFlight })
    return inFlight
  }

  return { load, invalidate }
}

export const dashboardSnapshotCache = createDashboardSnapshotCache()
