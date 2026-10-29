import { z } from "zod"
import { supabase } from "@/lib/supabase"

export const requestDomains = ["transfer", "withdrawal", "makeup", "textbook"] as const
export type RequestDomain = typeof requestDomains[number]
export const requestActions = ["create", "update", "withdraw", "change_request", "cancel_request"] as const
export type RequestAction = typeof requestActions[number]
export const domainLabels: Record<RequestDomain, string> = { transfer: "전반", withdrawal: "퇴원", makeup: "휴보강", textbook: "교재요청" }
export const actionLabels: Record<RequestAction, string> = { create: "신청 등록", update: "수정 저장", withdraw: "신청 철회", change_request: "변경 요청", cancel_request: "취소 요청" }
const uuid = z.string().uuid()
const text = z.string()
const date = text.regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
const note = text.max(4000)
const lessonHours = text.regex(/^(?:|(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?)$/)
const makeupSlotInputSchema = z.object({ startAt: text, endAt: text, classroom: text }).strict()
const inputSchemas = {
  transfer: z.object({ student_id: uuid, memo: note, from_class_id: uuid, to_class_id: uuid, transfer_reason: note,
    from_class_end_date: date, from_class_end_session: note, to_class_start_date: date, to_class_start_session: note,
    from_undistributed_textbooks: note, to_undistributed_textbooks: note }).strict(),
  withdrawal: z.object({ student_id: uuid, memo: note, class_id: uuid, withdrawal_date: date, withdrawal_session: note,
    customer_reason: note, teacher_opinion: note, undistributed_textbooks: note,
    completed_lesson_hours: lessonHours.optional(), four_week_lesson_hours: lessonHours.optional(),
  }).strict().refine(value => (value.completed_lesson_hours === undefined) === (value.four_week_lesson_hours === undefined)),
  makeup: z.object({ request_kind: z.enum(["cancel_makeup", "cancel_only", "makeup_only"]), class_id: uuid, reason: note,
    cancel_date: date, original_lesson_session_id: uuid.nullable(), makeup_slots: z.array(makeupSlotInputSchema).max(30) }).strict(),
  textbook: z.object({ title: text, textbookId: uuid.nullable(), classId: uuid.nullable(), locationId: uuid.nullable(),
    studentQuantity: z.number().int().min(0).max(2147483647), teacherQuantity: z.number().int().min(0).max(2147483647), memo: note }).strict(),
}
// Management may persist a UI slot id; it is read metadata, never owner input.
const makeupDetailInputSchema = inputSchemas.makeup.extend({
  makeup_slots: z.array(makeupSlotInputSchema.extend({ id: text.optional() })
    .transform(({ startAt, endAt, classroom }) => ({ startAt, endAt, classroom }))).max(30),
})
export type RequestInput = Record<string, unknown>
export function teacherWithdrawalHoursDisplay(input: RequestInput) {
  const hours = (value: unknown) => lessonHours.safeParse(value).success && value !== "" ? Number(value) : null
  const completed = hours(input.completed_lesson_hours), total = hours(input.four_week_lesson_hours)
  return {
    completed: completed === null ? "계산된 값 없음" : String(completed),
    total: total === null ? "계산된 값 없음" : String(total),
    progress: completed === null || total === null || total === 0 ? "계산된 값 없음" : `${Math.min(100, Math.round(100 * completed / total))}%`,
  }
}
export type MakeupSlot = { startAt: string; endAt: string; classroom: string }
const labelsSchema = z.object({ student: text.optional(), class: text.optional(), fromClass: text.optional(), toClass: text.optional(), textbook: text.optional(), location: text.optional() }).strict()
const approverSchema = z.object({ profileId: uuid.nullable(), label: text.nullable() }).strict().nullable()
const summarySchema = z.object({ id: uuid, domain: z.enum(requestDomains), title: text, status: text, requesterId: uuid,
  createdAt: text.nullable(), updatedAt: text.nullable(), revision: text.min(1), allowedActions: z.array(z.enum(requestActions).exclude(["create"])),
  blockedReason: text.nullable(), effectState: z.enum(["none", "observed", "unknown"]), referenceLabels: labelsSchema, approver: approverSchema }).strict()
const changeSchema = z.object({ id: uuid, kind: z.enum(["change_request", "cancel_request"]), note: text,
  status: z.enum(["pending", "confirmed", "rejected"]), createdAt: text, resolvedAt: text.nullable(), resolutionNote: text.nullable(), revision: text.min(1) }).strict()
const detailSchema = summarySchema.extend({ input: z.record(text, z.unknown()).nullable(),
  history: z.array(z.object({ id: uuid, action: text, actorId: uuid, note: text, createdAt: text }).strict()), changes: z.array(changeSchema) }).strict()
export type OwnRequest = z.infer<typeof summarySchema>
export type OwnRequestDetail = z.infer<typeof detailSchema>
const inboxSchema = changeSchema.extend({ domain: z.enum(requestDomains), requestId: uuid, requesterId: uuid,
  title: text, requestStatus: text.nullable(), anchorId: uuid.nullable(),
  canResolve: z.boolean(), canRecordProgress: z.boolean(),
  progressNotes: z.array(z.object({ id: uuid, note: text, createdAt: text }).strict()) }).strict()
export type RequestChange = z.infer<typeof inboxSchema>
const referencesSchema = z.object({
  classes: z.array(z.object({ id: uuid, name: text, scheduleStorageMode: text.nullable() }).strict()).max(1),
  students: z.array(z.object({ id: uuid, name: text, status: z.enum(["enrolled", "waitlisted"]) }).strict()),
  rooms: z.array(z.object({ name: text }).strict()),
  sessions: z.array(z.object({ id: uuid, date: text, startTime: text.nullable(), endTime: text.nullable(), revision: z.union([text, z.number()]) }).strict()),
  approver: z.object({ label: text.nullable(), status: text.nullable() }).strict().nullable(),
}).strict()
export type RequestReferences = z.infer<typeof referencesSchema>
export type RequestPage<T> = { rows: T[]; totalCount: number; page: number; pageSize: number }
const invalid = () => new Error("신청 데이터 형식을 확인하지 못했습니다.")
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) throw invalid(); return result.data }
export function parseRequestInput(domain: RequestDomain, value: unknown): RequestInput { return parse<RequestInput>(inputSchemas[domain], value) }
function parseDetail(value: unknown, domain: RequestDomain, actorId: string, id?: string) {
  const detail = parse(detailSchema, value)
  if (detail.domain !== domain || detail.requesterId !== actorId || id && detail.id !== id) throw invalid()
  if (detail.input) detail.input = domain === "makeup"
    ? parse<RequestInput>(makeupDetailInputSchema, detail.input)
    : parseRequestInput(domain, detail.input)
  if (!detail.input && detail.allowedActions.some(action => action === "update" || action === "withdraw")) throw invalid()
  return detail
}
async function rpc(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
  if (!supabase) throw new Error("로그인 연결을 확인해 주세요.")
  const deadline = signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000)
  const { data, error } = await supabase.rpc(name, args).abortSignal(deadline).retry(false)
  deadline.throwIfAborted()
  if (error) throw error
  return data
}
function pageOf<T>(schema: z.ZodType<T>, data: unknown, page: number): RequestPage<T> {
  const value = parse(z.object({ rows: z.array(schema), totalCount: z.number().int().nonnegative(), page: z.number().int(), pageSize: z.literal(10) }).strict(), data)
  if (value.page !== page || value.rows.length !== Math.min(10, Math.max(0, value.totalCount - (page - 1) * 10))) throw invalid()
  return value
}
export async function readMyMakeupDirectorSubjects(signal: AbortSignal) {
  return parse(z.array(z.enum(["영어", "수학", "과학"])).max(3), await rpc("get_my_makeup_director_subjects_v1", {}, signal))
}
export async function readOwnRequests(domain: RequestDomain, actorId: string, page: number, signal: AbortSignal) {
  const result = pageOf(summarySchema, await rpc("get_teacher_own_requests_v1", { p_domain: domain, p_page: page, p_page_size: 10 }, signal), page)
  if (result.rows.some(row => row.domain !== domain || row.requesterId !== actorId) || new Set(result.rows.map(row => row.id)).size !== result.rows.length) throw invalid()
  return result
}
export async function readOwnRequest(domain: RequestDomain, actorId: string, id: string, signal: AbortSignal) {
  return parseDetail(await rpc("get_teacher_own_request_v1", { p_domain: domain, p_id: id }, signal), domain, actorId, id)
}
export async function readRequestReferences(domain: RequestDomain, classId: string | null, month: string, signal: AbortSignal) {
  const result = parse(referencesSchema, await rpc("get_teacher_request_references_v1", { p_domain: domain, p_class_id: classId, p_month: month }, signal))
  if (!classId || domain === "textbook") {
    if (result.classes.length || result.students.length || result.rooms.length || result.sessions.length || result.approver) throw invalid()
  } else {
    if (result.classes.length !== 1 || result.classes[0].id !== classId) throw invalid()
    if (domain === "makeup") {
      if (result.students.length || result.sessions.some(session => !session.date.startsWith(`${month}-`))) throw invalid()
    } else if (result.sessions.length || result.rooms.length || result.approver) throw invalid()
  }
  if (new Set(result.students.map(student => student.id)).size !== result.students.length || new Set(result.sessions.map(session => session.id)).size !== result.sessions.length) throw invalid()
  return result
}
export type RequestAttempt = { domain: RequestDomain; id: string | null; action: RequestAction; input: RequestInput; revision: string | null; requestId: string }
export async function mutateOwnRequest(actorId: string, attempt: RequestAttempt) {
  // Hours are read/display metadata. Keep the established eight-key write
  // contract on both database versions; the updated server owns calculation.
  const input = { ...attempt.input }
  if (attempt.domain === "withdrawal" && (attempt.action === "create" || attempt.action === "update")) {
    delete input.completed_lesson_hours
    delete input.four_week_lesson_hours
  }
  try {
    if (attempt.action === "create" || attempt.action === "update") parseRequestInput(attempt.domain, input)
    else parse(z.object({ note: note.trim().min(1) }).strict(), input)
  } catch { throw Object.assign(new Error("신청 입력을 확인해 주세요."), { code: "22023" }) }
  const data = await rpc("mutate_teacher_own_request_v1", { p_domain: attempt.domain, p_id: attempt.id, p_action: attempt.action,
    p_input: input, p_expected_revision: attempt.revision, p_request_id: attempt.requestId })
  return parseDetail(data, attempt.domain, actorId, attempt.id || undefined)
}
export async function readRequestChanges(domain: RequestDomain, page: number, signal: AbortSignal) {
  const result = pageOf(inboxSchema, await rpc("get_teacher_request_changes_v1", { p_domain: domain, p_page: page, p_page_size: 10 }, signal), page)
  if (result.rows.some(row => row.domain !== domain)) throw invalid()
  return result
}
export type ResolveAttempt = { id: string; resolution: "confirmed" | "rejected" | "noted"; note: string; revision: string; requestId: string }
export async function resolveRequestChange(attempt: ResolveAttempt) {
  const data = await rpc("resolve_teacher_request_change_v1", { p_change_id: attempt.id, p_resolution: attempt.resolution,
    p_note: attempt.note, p_expected_revision: attempt.revision, p_request_id: attempt.requestId })
  const result = parse(changeSchema.extend({ domain: z.enum(requestDomains), requestId: uuid }).strict(), data)
  if (result.id !== attempt.id) throw invalid()
  return result
}
export function failureCode(error: unknown) { return error && typeof error === "object" && "code" in error ? String(error.code) : "" }
export function isDefinitiveRequestFailure(error: unknown) { return ["22023", "22P02", "22007", "22008", "23503", "23514", "42501", "P0002"].includes(failureCode(error)) }
export function requestFailureMessage(error: unknown) {
  const code = failureCode(error)
  if (code === "42501") return "신청 권한 또는 로그인 상태가 변경됐습니다. 화면을 다시 확인해 주세요."
  if (code === "23514") return "신청 내용이나 처리 상태가 변경됐습니다. 최신 신청을 확인한 후 다시 진행해 주세요."
  if (isDefinitiveRequestFailure(error)) return "신청을 저장하지 못했습니다. 선택 항목과 입력 내용을 확인해 주세요."
  return "저장 결과를 확인하지 못했습니다. 입력을 유지한 채 같은 요청의 결과를 확인해 주세요."
}
export function requestStatusLabel(status: string) { return ({ requested: "접수", confirmed: "확인", review_requested: "보완 요청", in_progress: "처리 중", on_hold: "보류", processing: "처리 중", done: "처리 완료", approval_pending: "원장 승인 대기", revision_requested: "보완 요청", manager_pending: "관리팀 처리 대기", makeup_pending: "보강 일정 대기", refund_pending: "환불 처리 대기", completed: "완료", canceled: "철회·취소", cancelled: "철회·취소", rejected: "반려", ordered: "주문", received: "입고", partially_received: "일부 입고", returned: "반품" } as Record<string, string>)[status] || "상태 확인 필요" }
export function originalRequestHref(row: RequestChange) {
  if (!row.anchorId) return null
  if (row.domain === "textbook") return `/admin/textbooks?textbookTab=${row.requestStatus === "requested" ? "requests" : "purchase"}&textbookDetailKind=purchase&textbookDetail=${row.anchorId}`
  if (row.domain === "makeup") return `/admin/makeup-requests?requestId=${row.anchorId}`
  return `/admin/${row.domain}?taskId=${row.anchorId}`
}
