export type DashboardSnapshotKind = "summary" | "conflict"

export type DashboardSnapshotCache = {
  load<T>(
    scope: string,
    kind: DashboardSnapshotKind,
    loader: () => Promise<T> | T,
    options?: { force?: boolean },
  ): Promise<T>
  invalidate(scope: string, kind?: DashboardSnapshotKind): void
}

export const DASHBOARD_SNAPSHOT_VERSION: "dashboard-snapshot-v1"

export function createDashboardSnapshotCache(options?: {
  ttlMs?: number
  now?: () => number
}): DashboardSnapshotCache

export const dashboardSnapshotCache: DashboardSnapshotCache
