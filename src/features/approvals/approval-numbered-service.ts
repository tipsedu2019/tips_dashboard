import { supabase } from "@/lib/supabase"
import { validatePageSize, type DataTablePageSize, type NumberedPage } from "@/lib/numbered-pagination"
import { parseChecklistItems, type ApprovalRequest } from "./approval-service"

export type ApprovalListView = "mine" | "review" | "open" | "done" | "returned"
export type ApprovalNumberedPage = NumberedPage<ApprovalRequest> & { tabCounts: Record<ApprovalListView, number> }
const views: ApprovalListView[] = ["mine", "review", "open", "done", "returned"]
const statuses = ["draft", "submitted", "reviewing", "approved", "returned", "canceled"]
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0
const identifier = (value: unknown, empty = false) => typeof value === "string" && ((empty && value === "") || uuid.test(value))
const strings = (value: Record<string, unknown>, keys: string[]) => keys.every((key) => typeof value[key] === "string")
const error = (code: string) => Object.assign(new Error(code), { code })
const timestamp = (value: unknown, empty = false) => typeof value === "string" && ((empty && value === "") || Number.isFinite(Date.parse(value)))
type ApprovalWireRequest = Omit<ApprovalRequest, "checklistItems"> & { checklistItems: unknown }

function isRequest(value: unknown): value is ApprovalWireRequest {
  if (!object(value) || !identifier(value.id) || !identifier(value.requesterId, true) || !identifier(value.approverId, true)
    || !strings(value, ["type", "status", "subject"])
    || !["monthly_report", "general"].includes(String(value.type)) || !statuses.includes(String(value.status))
    || !["english", "math", "general"].includes(String(value.subject))
    || !strings(value, ["title", "requesterLabel", "approverLabel", "templateKey", "reportMonth", "classSummary", "studentIssues", "nextMonthPlan", "body", "attachmentLinks", "memo", "submittedAt", "decidedAt", "createdAt", "updatedAt"])
    || !Object.prototype.hasOwnProperty.call(value, "checklistItems") || value.checklistItems === undefined
    || !timestamp(value.createdAt) || !timestamp(value.updatedAt) || !timestamp(value.submittedAt, true) || !timestamp(value.decidedAt, true)
    || !Array.isArray(value.comments) || !Array.isArray(value.events)) return false
  const child = (item: unknown) => object(item) && identifier(item.id) && item.approvalId === value.id
  if (!value.comments.every((item) => child(item) && object(item) && identifier(item.authorId, true) && strings(item, ["authorLabel", "body", "createdAt"]) && timestamp(item.createdAt))) return false
  if (!value.events.every((item) => child(item) && object(item) && identifier(item.actorId, true) && strings(item, ["actorLabel", "eventType", "fieldName", "beforeValue", "afterValue", "createdAt"]) && timestamp(item.createdAt))) return false
  return new Set(value.comments.map((item) => item.id)).size === value.comments.length
    && new Set(value.events.map((item) => item.id)).size === value.events.length
}

function assertReadResult(failure: { code: string } | null) {
  if (failure) {
    if (["PGRST202", "42883"].includes(failure.code)) throw Object.assign(error("approval_numbered_rpc_unavailable"), { cause: failure })
    throw failure
  }
}

export async function readApprovalNumberedPage({ view, page, pageSize, signal }: {
  view: ApprovalListView; page: number; pageSize: DataTablePageSize; signal?: AbortSignal
}): Promise<ApprovalNumberedPage> {
  if (!views.includes(view) || !Number.isInteger(page) || page < 1 || page > 2147483647) throw error("approval_numbered_request_invalid")
  validatePageSize(pageSize)
  if (!supabase) throw error("approval_client_missing")
  signal?.throwIfAborted()
  const deadline = AbortSignal.timeout(8_000)
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
  const { data, error: failure } = await supabase.rpc("list_approval_numbered_page_v1", { p_view: view, p_page: page, p_page_size: pageSize }).abortSignal(combined).retry(false)
  combined.throwIfAborted()
  assertReadResult(failure)
  if (!object(data) || data.page !== page || data.pageSize !== pageSize || !count(data.totalCount)
    || !object(data.tabCounts) || Object.keys(data.tabCounts).length !== views.length
    || !views.every((key) => count((data.tabCounts as Record<string, unknown>)[key])) || data.tabCounts[view] !== data.totalCount
    || !Array.isArray(data.rows) || !data.rows.every(isRequest)
    || data.rows.length !== Math.min(pageSize, Math.max(0, data.totalCount - (page - 1) * pageSize))
    || new Set(data.rows.map((row) => row.id)).size !== data.rows.length) throw error("approval_numbered_response_invalid")
  return { rows: data.rows.map((row) => ({ ...row, checklistItems: parseChecklistItems(row.checklistItems) })), page, pageSize, totalCount: data.totalCount, tabCounts: data.tabCounts as ApprovalNumberedPage["tabCounts"] }
}

export async function readApprovalDetail({ id, signal }: { id: string; signal?: AbortSignal }): Promise<ApprovalRequest | null> {
  if (!identifier(id)) throw error("approval_detail_request_invalid")
  if (!supabase) throw error("approval_client_missing")
  signal?.throwIfAborted()
  const deadline = AbortSignal.timeout(8_000)
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
  const { data, error: failure } = await supabase.rpc("get_approval_detail_v1", { p_id: id }).abortSignal(combined).retry(false)
  combined.throwIfAborted()
  assertReadResult(failure)
  if (data === null) return null
  if (!isRequest(data) || data.id.toLowerCase() !== id.toLowerCase()) throw error("approval_detail_response_invalid")
  return { ...data, checklistItems: parseChecklistItems(data.checklistItems) }
}
