export function startOpsTaskPageSupplementLoad<TStats, TRuntime>(loaders: {
  loadStats: () => Promise<TStats>
  loadRegistrationRuntime: () => Promise<TRuntime>
}) {
  return {
    stats: Promise.resolve().then(loaders.loadStats).catch(() => undefined),
    registrationRuntime: Promise.resolve().then(loaders.loadRegistrationRuntime).catch(() => null),
  }
}

export function mergeOpsTaskPageSupplement<
  TData extends object,
  TStats,
  TRuntime,
>(
  data: TData,
  supplement: { stats?: TStats; registrationRuntime?: TRuntime | null },
) {
  return { ...data, ...supplement }
}
