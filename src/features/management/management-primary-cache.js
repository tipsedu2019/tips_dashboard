const DEFAULT_MANAGEMENT_PRIMARY_CACHE_TTL_MS = 60_000;

export function createManagementPrimaryRowsCache({
  ttlMs = DEFAULT_MANAGEMENT_PRIMARY_CACHE_TTL_MS,
  now = () => Date.now(),
} = {}) {
  const entries = new Map();

  return {
    read(kind) {
      const entry = entries.get(kind);
      if (!entry) return null;

      if (now() - entry.cachedAt > ttlMs) {
        entries.delete(kind);
        return null;
      }

      return [...entry.rows];
    },

    write(kind, rows) {
      entries.set(kind, {
        cachedAt: now(),
        rows: [...rows],
      });
    },

    clear(kind) {
      if (kind) {
        entries.delete(kind);
        return;
      }
      entries.clear();
    },
  };
}

export const managementPrimaryRowsCache = createManagementPrimaryRowsCache();
