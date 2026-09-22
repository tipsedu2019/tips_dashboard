import {
  normalizeWorkloadPage,
  normalizeWorkloadSummary,
  type WorkloadFilter,
} from "./workload-contract.ts"

export type WorkloadClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => {
    abortSignal: (signal: AbortSignal) => {
      retry: (
        enabled: boolean,
      ) => PromiseLike<{ data: unknown; error: unknown }>
    }
  }
}
async function read(
  client: WorkloadClient,
  name: string,
  args?: Record<string, unknown>,
) {
  const result = await client
    .rpc(name, args)
    .abortSignal(AbortSignal.timeout(8_000))
    .retry(false)
  if (result.error) throw result.error
  return result.data
}
export async function readWorkloadSummary(client: WorkloadClient) {
  return normalizeWorkloadSummary(
    await read(client, "get_dashboard_workload_v1"),
  )
}
export async function readWorkloadPage(
  client: WorkloadClient,
  filter: WorkloadFilter,
  page: number,
  pageSize: 10 | 15 | 20,
) {
  const result = normalizeWorkloadPage(
    await read(client, "list_dashboard_workload_page_v1", {
      p_team: filter.team,
      p_owner_key: filter.ownerKey ?? null,
      p_workflow: filter.workflow ?? null,
      p_stage: filter.stage ?? null,
      p_aged_only: filter.agedOnly ?? false,
      p_page: page,
      p_page_size: pageSize,
    }),
  )
  if (
    result.page !== page ||
    result.pageSize !== pageSize ||
    result.rows.some(
      (row) =>
        row.team !== filter.team ||
        (filter.ownerKey !== undefined && row.ownerKey !== filter.ownerKey) ||
        (filter.workflow !== undefined && row.workflow !== filter.workflow) ||
        (filter.stage !== undefined && row.stage !== filter.stage),
    )
  )
    throw new Error("dashboard_workload_scope_mismatch")
  return result
}
