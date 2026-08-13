import {
  normalizeDashboardDailyBrief,
  type DashboardDailyBrief,
} from "./daily-brief-contract.ts"

type DashboardDailyBriefRpcResult = Readonly<{
  data: unknown
  error: unknown
}>

type DashboardDailyBriefRpcRequest = Readonly<{
  abortSignal: (signal: AbortSignal) => {
    retry: (enabled: boolean) => PromiseLike<DashboardDailyBriefRpcResult>
  }
}>

export type DashboardDailyBriefClient = Readonly<{
  rpc: (name: "get_dashboard_daily_brief_v1") => DashboardDailyBriefRpcRequest
}>

export async function readDashboardDailyBrief(
  client: DashboardDailyBriefClient,
): Promise<DashboardDailyBrief> {
  const result = await client
    .rpc("get_dashboard_daily_brief_v1")
    .abortSignal(AbortSignal.timeout(8_000))
    .retry(false)

  if (result.error) throw result.error
  return normalizeDashboardDailyBrief(result.data)
}
