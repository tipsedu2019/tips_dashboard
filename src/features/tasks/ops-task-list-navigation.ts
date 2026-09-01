import { validatePageSize, type DataTablePageSize } from "@/lib/numbered-pagination"
import { assertOpsTaskPageFilters, type OpsTaskPageFilters } from "./ops-task-service"

export type OpsTaskListNavigation = {
  version: 1
  actorScope: string
  pathname: string
  filters: OpsTaskPageFilters
  page: number
  pageSize: DataTablePageSize
  scrollY: number
}

export function readOpsTaskListNavigation(state: unknown, actorScope: string, pathname: string, taskType: OpsTaskPageFilters["taskType"]): OpsTaskListNavigation | null {
  if (!state || typeof state !== "object") return null
  const saved = (state as { tipsOpsTaskList?: OpsTaskListNavigation }).tipsOpsTaskList
  if (!saved || saved.version !== 1 || saved.actorScope !== actorScope || saved.pathname !== pathname
    || saved.filters?.taskType !== taskType || !Number.isInteger(saved.page) || saved.page < 1 || saved.page > 2147483647
    || !Number.isFinite(saved.scrollY) || saved.scrollY < 0) return null
  try { assertOpsTaskPageFilters(saved.filters); validatePageSize(saved.pageSize) } catch { return null }
  // Persist only the known navigation contract, never incidental DTOs/drafts.
  return { version: 1, actorScope, pathname, filters: saved.filters, page: saved.page, pageSize: saved.pageSize, scrollY: saved.scrollY }
}

export function writeOpsTaskListNavigation(target: Pick<Window, "location" | "history">, snapshot: OpsTaskListNavigation) {
  const params = new URLSearchParams(target.location.search)
  // Observation links intentionally accept exactly five keys. Their list return
  // context lives solely in history.state, never in the deep-link query.
  if (!params.has("observationId")) {
    params.set("taskPage", String(snapshot.page))
    params.set("taskPageType", snapshot.filters.taskType)
  }
  const search = params.toString()
  target.history.replaceState({ ...target.history.state, tipsOpsTaskList: snapshot }, "", `${target.location.pathname}${search ? `?${search}` : ""}`)
}
