import { supabase } from "@/lib/supabase"

export type TeacherBookOptionScope = "textbooks" | "classes" | "locations"
export type TeacherBookOption = { id: string; label: string }
export type TeacherTextbookSubmission = { title: string; textbookId: string | null; classId: string | null; locationId: string | null; studentQuantity: number; teacherQuantity: number; memo: string }
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
const invalid = () => new Error("교재요청 입력 형식을 확인해 주세요.")

export async function readTeacherTextbookRequestOptions(input: { scope: TeacherBookOptionScope; search: string; page: number }, signal: AbortSignal): Promise<{ rows: TeacherBookOption[]; totalCount: number }> {
  if (!supabase) throw new Error("로그인 연결을 확인하세요.")
  if (!["textbooks", "classes", "locations"].includes(input.scope) || typeof input.search !== "string" || !Number.isSafeInteger(input.page) || input.page < 1) throw invalid()
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(8_000)])
  const { data, error } = await supabase.rpc("read_operational_common_v1", { p_operation: "book_request_options", p_args: { scope: input.scope, search: input.search, page: input.page, pageSize: 15 } }).abortSignal(deadline).retry(false)
  deadline.throwIfAborted()
  if (error) throw error
  if (!object(data) || data.page !== input.page || data.pageSize !== 15 || !Number.isSafeInteger(data.totalCount) || (data.totalCount as number) < 0 || !Array.isArray(data.rows)) throw invalid()
  const rows: TeacherBookOption[] = []
  for (const row of data.rows) {
    if (!object(row) || Object.keys(row).length !== 2 || !uuid(row.id) || typeof row.label !== "string") throw invalid()
    rows.push({ id: row.id, label: row.label })
  }
  if (new Set(rows.map(row => row.id)).size !== rows.length || rows.length !== Math.min(15, Math.max(0, (data.totalCount as number) - (input.page - 1) * 15))) throw invalid()
  return { rows, totalCount: data.totalCount as number }
}

export async function submitTeacherTextbookRequest(requestId: string, input: TeacherTextbookSubmission): Promise<{ orderId: string }> {
  if (!supabase) throw new Error("로그인 연결을 확인하세요.")
  if (!uuid(requestId) || !input.title.trim() || ![input.studentQuantity, input.teacherQuantity].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 2147483647)
    || input.studentQuantity + input.teacherQuantity < 1 || ![input.textbookId, input.classId, input.locationId].every(value => value === null || uuid(value)) || typeof input.memo !== "string") throw invalid()
  const { data, error } = await supabase.rpc("submit_teacher_textbook_request_v1", { p_request_id: requestId, p_input: input }).abortSignal(AbortSignal.timeout(8_000)).retry(false)
  if (error) throw error
  if (!object(data) || Object.keys(data).length !== 1 || !uuid(data.orderId)) throw invalid()
  return { orderId: data.orderId }
}
