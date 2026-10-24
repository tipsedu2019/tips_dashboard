import { supabase as sharedClient } from "@/lib/supabase"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { DataTablePageSize, NumberedPage } from "@/lib/numbered-pagination"

export type TeacherTextbookRequest = { id: string; anchorLineId: string; bookTitle: string; className: string; requesterLabel: string; requestedAt: string; studentQuantity: number; teacherQuantity: number }
const keys = ["id", "anchorLineId", "bookTitle", "className", "requesterLabel", "requestedAt", "studentQuantity", "teacherQuantity"]
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
function invalid(): never { throw new Error("교재요청 공통정보 형식을 확인할 수 없습니다.") }
function validateRow(row: unknown): asserts row is TeacherTextbookRequest {
    if (!object(row) || Object.keys(row).length !== keys.length || !keys.every(key => Object.prototype.hasOwnProperty.call(row, key))
      || typeof row.id !== "string" || !/^[a-f0-9]{32}$/.test(row.id) || typeof row.anchorLineId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(row.anchorLineId)
      || !["bookTitle", "className", "requesterLabel", "requestedAt"].every(key => typeof row[key] === "string") || !isCount(row.studentQuantity) || !isCount(row.teacherQuantity)) invalid()
  }
export async function readTeacherTextbookRequests(input: { search: string; page: number; pageSize: DataTablePageSize }, options: { client?: SupabaseClient | null; signal?: AbortSignal } = {}): Promise<NumberedPage<TeacherTextbookRequest>> {
  if (typeof input.search !== "string" || !Number.isInteger(input.page) || input.page < 1 || ![10, 15, 20].includes(input.pageSize)) invalid()
  const client = options.client === undefined ? sharedClient : options.client
  if (!client) throw new Error("로그인 연결을 확인하세요.")
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000)
  const { data, error } = await client.rpc("read_operational_common_v1", { p_operation: "book_page", p_args: { p_search: input.search, p_page: input.page, p_page_size: input.pageSize } }).abortSignal(signal).retry(false)
  signal.throwIfAborted()
  if (error) throw error
  if (!object(data) || data.page !== input.page || data.pageSize !== input.pageSize || !isCount(data.totalCount) || !Array.isArray(data.rows)) invalid()
  for (const row of data.rows) validateRow(row)
  if (data.rows.length !== Math.min(input.pageSize, Math.max(0, data.totalCount - (input.page - 1) * input.pageSize)) || new Set(data.rows.map(row => row.id)).size !== data.rows.length) invalid()
  return data as NumberedPage<TeacherTextbookRequest>
}

export async function readTeacherTextbookRequestDetail(anchorLineId: string, signal?: AbortSignal, client = sharedClient): Promise<TeacherTextbookRequest | null> {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(anchorLineId)) invalid()
  if (!client) throw new Error("로그인 연결을 확인하세요.")
  const deadline = signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000)
  const { data, error } = await client.rpc("read_operational_common_v1", { p_operation: "book_detail", p_args: { p_anchor: anchorLineId } }).abortSignal(deadline).retry(false)
  deadline.throwIfAborted()
  if (error) throw error
  if (data === null) return null
  validateRow(data)
  return data
}
