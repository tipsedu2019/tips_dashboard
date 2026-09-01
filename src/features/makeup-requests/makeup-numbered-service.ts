"use client"

import { supabase } from "@/lib/supabase"
import { validatePageSize, type DataTablePageSize, type NumberedPage } from "@/lib/numbered-pagination"
import { normalizeMakeupSlots } from "./makeup-request-model.js"
import type { MakeupRequest, MakeupSlotInput } from "./makeup-request-service"

export const MAKEUP_NUMBERED_COLUMNS = ["status", "className", "subject", "teacher", "requester", "reason", "cancelDate", "makeupAt", "makeupRoom", "approver", "submittedAt", "revisionRequestedAt", "approvedAt", "rejectedAt", "canceledAt", "returnedReason", "rejectedReason", "finalNote", "canceledNote"] as const
export type MakeupNumberedColumn = typeof MAKEUP_NUMBERED_COLUMNS[number]
export type MakeupNumberedFilters = {
  view: "mine" | "approvalPending" | "makeupPending" | "refundPending" | "closed"
  subject: string; teacher: string; period: "all" | "today" | "week" | "month" | "custom"
  dateFrom: string; dateTo: string; filterColumn: MakeupNumberedColumn; search: string
  sortColumn: MakeupNumberedColumn | null; sortDirection: "asc" | "desc" | null
}
export type MakeupFilterOption = { value: string; label: string; count: number }
export type MakeupNumberedPage = NumberedPage<MakeupRequest> & {
  viewCounts: Record<MakeupNumberedFilters["view"], number>
  subjectOptions: MakeupFilterOption[]; teacherOptions: MakeupFilterOption[]
}
export type MakeupReservation = Pick<MakeupRequest, "id" | "status" | "className" | "makeupStartAt" | "makeupEndAt" | "makeupClassroom" | "makeupSlots">
export type MakeupReservationContext = { reservations: MakeupReservation[]; activeEventRequestIds: string[] }

const views = ["mine", "approvalPending", "makeupPending", "refundPending", "closed"]
const statuses = ["approval_pending", "revision_requested", "rejected", "manager_pending", "makeup_pending", "refund_pending", "completed", "canceled"]
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const invalid = (message: string) => new Error(message)
const optionalId = (value: unknown) => value === "" || uuid(value)
const uniqueIds = (values: unknown[]) => values.every(uuid) && new Set(values.map((value) => String(value).toLowerCase())).size === values.length
// Source timestamps intentionally remain raw: Date.parse belongs to the collision model.
const isSlot = (value: unknown) => object(value)
  && typeof value.startAt === "string" && Boolean(value.startAt.trim())
  && typeof value.endAt === "string" && Boolean(value.endAt.trim())
  && (value.id === undefined || typeof value.id === "string")
  && (value.classroom === undefined || typeof value.classroom === "string")
function isRawSlotsEnvelope(value: Record<string, unknown>) {
  if (!("rawMakeupSlots" in value)) return true
  if (Array.isArray(value.rawMakeupSlots)) return true
  if (typeof value.rawMakeupSlots !== "string") return false
  try { return Array.isArray(JSON.parse(value.rawMakeupSlots)) } catch { return false }
}
function normalizeWireSlots<T extends MakeupReservation>(wire: T): T {
  const { rawMakeupSlots, ...row } = wire as T & { rawMakeupSlots?: unknown }
  const makeupSlots = normalizeMakeupSlots({ ...row, makeupSlots: rawMakeupSlots === undefined ? row.makeupSlots : rawMakeupSlots }, row.makeupClassroom)
  if (!makeupSlots.every(isSlot)) throw invalid("makeup_numbered_response_invalid")
  return { ...row, makeupSlots } as T
}
const stringKeys = ["subject", "approvalGroup", "requesterId", "requesterLabel", "teacherCatalogId", "teacherProfileId", "teacherLabel", "classId", "className", "requestKind", "reason", "cancelDate", "makeupStartAt", "makeupEndAt", "makeupClassroom", "approverTeacherCatalogId", "approverProfileId", "approverLabel", "returnedReason", "rejectedReason", "finalNote", "approvedBy", "approvedByLabel", "approvedAt", "completedBy", "completedByLabel", "completedAt", "canceledBy", "canceledByLabel", "canceledAt", "cancelAcademicEventId", "makeupAcademicEventId", "createdAt", "updatedAt"]
function isRequest(value: unknown): value is MakeupRequest {
  return object(value) && isRawSlotsEnvelope(value) && uuid(value.id) && typeof value.status === "string" && statuses.includes(value.status)
    && stringKeys.every((key) => typeof value[key] === "string") && Boolean(value.createdAt) && Boolean(value.updatedAt)
    && ["cancel_makeup", "cancel_only", "makeup_only"].includes(String(value.requestKind))
    && ["requesterId", "teacherCatalogId", "teacherProfileId", "classId", "approverTeacherCatalogId", "approverProfileId", "approvedBy", "completedBy", "canceledBy", "cancelAcademicEventId", "makeupAcademicEventId"].every((key) => optionalId(value[key]))
    && Array.isArray(value.makeupSlots) && value.makeupSlots.every(isSlot) && object(value.schedulePlanBefore) && object(value.schedulePlanAfter)
    && Array.isArray(value.makeupAcademicEventIds) && uniqueIds(value.makeupAcademicEventIds)
    && Array.isArray(value.events) && value.events.every((event) => object(event) && uuid(event.id) && event.requestId === value.id
      && optionalId(event.actorId) && ["actorId", "actorLabel", "eventType", "fieldName", "beforeValue", "afterValue", "note", "createdAt"].every((key) => typeof event[key] === "string"))
    && uniqueIds(value.events.map((event) => event.id))
}
function isOption(value: unknown): value is MakeupFilterOption {
  return object(value) && typeof value.value === "string" && Boolean(value.value) && typeof value.label === "string" && Boolean(value.label) && count(value.count)
}
function validateFilters(filters: MakeupNumberedFilters) {
  const keys = ["view", "subject", "teacher", "period", "dateFrom", "dateTo", "filterColumn", "search", "sortColumn", "sortDirection"]
  if (!object(filters) || Object.keys(filters).length !== keys.length || !keys.every((key) => key in filters)
    || !views.includes(filters.view) || !["all", "영어", "수학", "과학"].includes(filters.subject)
    || typeof filters.teacher !== "string" || !(filters.teacher === "all" || filters.teacher.startsWith("id:") && uuid(filters.teacher.slice(3)) || /^name:.+/.test(filters.teacher))
    || !["all", "today", "week", "month", "custom"].includes(filters.period) || typeof filters.search !== "string"
    || !MAKEUP_NUMBERED_COLUMNS.includes(filters.filterColumn)
    || !(filters.sortColumn === null && filters.sortDirection === null || MAKEUP_NUMBERED_COLUMNS.includes(filters.sortColumn!) && ["asc", "desc"].includes(filters.sortDirection!))) throw invalid("makeup_numbered_request_invalid")
  for (const value of [filters.dateFrom, filters.dateTo]) {
    if (typeof value !== "string" || value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw invalid("makeup_numbered_request_invalid")
  }
  if (filters.period === "all" && (filters.dateFrom || filters.dateTo)
    || ["today", "week", "month"].includes(filters.period) && (!filters.dateFrom || !filters.dateTo)
    || filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) throw invalid("makeup_numbered_request_invalid")
}
function assertResult(error: unknown) {
  if (object(error) && ["PGRST202", "42883"].includes(String(error.code))) throw invalid("makeup_numbered_rpc_unavailable")
  if (error) throw error
}
export async function readMakeupNumberedPage({ filters, page, pageSize, signal }: { filters: MakeupNumberedFilters; page: number; pageSize: DataTablePageSize; signal?: AbortSignal }): Promise<MakeupNumberedPage> {
  validateFilters(filters); validatePageSize(pageSize)
  if (!Number.isInteger(page) || page < 1 || page > 2147483647) throw invalid("makeup_numbered_request_invalid")
  if (!supabase) throw invalid("makeup_client_missing")
  signal?.throwIfAborted()
  const deadline = AbortSignal.timeout(8_000)
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
  const { data, error } = await supabase.rpc("list_makeup_numbered_page_v1", { p_filters: filters, p_page: page, p_page_size: pageSize }).abortSignal(combined).retry(false)
  combined.throwIfAborted(); assertResult(error)
  if (!object(data) || data.page !== page || data.pageSize !== pageSize || !count(data.totalCount)
    || !object(data.viewCounts) || Object.keys(data.viewCounts).length !== views.length || !views.every((view) => count((data.viewCounts as Record<string, unknown>)[view]))
    || !Array.isArray(data.subjectOptions) || !data.subjectOptions.every(isOption) || data.subjectOptions.map((item) => item.value).join() !== "영어,수학,과학"
    || !Array.isArray(data.teacherOptions) || !data.teacherOptions.every(isOption) || new Set(data.teacherOptions.map((option) => option.value)).size !== data.teacherOptions.length
    || !Array.isArray(data.rows) || !data.rows.every(isRequest) || !uniqueIds(data.rows.map((row) => row.id))
    || data.rows.length !== Math.min(pageSize, Math.max(0, data.totalCount - (page - 1) * pageSize))) throw invalid("makeup_numbered_response_invalid")
  return { ...data, rows: data.rows.map(normalizeWireSlots) } as MakeupNumberedPage
}
export async function readMakeupDetail({ id, signal }: { id: string; signal?: AbortSignal }): Promise<MakeupRequest | null> {
  if (!uuid(id)) throw invalid("makeup_detail_request_invalid")
  if (!supabase) throw invalid("makeup_client_missing")
  signal?.throwIfAborted()
  const deadline = AbortSignal.timeout(8_000)
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
  const { data, error } = await supabase.rpc("get_makeup_detail_v1", { p_id: id }).abortSignal(combined).retry(false)
  combined.throwIfAborted(); assertResult(error)
  if (data === null) return null
  if (!isRequest(data) || data.id.toLowerCase() !== id.toLowerCase()) throw invalid("makeup_detail_response_invalid")
  return normalizeWireSlots(data)
}
export async function readMakeupReservationContext({ slots, eventRequestIds, signal }: { slots: MakeupSlotInput[]; eventRequestIds: string[]; signal?: AbortSignal }): Promise<MakeupReservationContext> {
  if (!Array.isArray(slots) || !slots.every((slot) => object(slot) && typeof slot.startAt === "string" && typeof slot.endAt === "string" && Number.isFinite(Date.parse(slot.startAt)) && Date.parse(slot.startAt) < Date.parse(slot.endAt))
    || !Array.isArray(eventRequestIds) || !eventRequestIds.every(uuid)) throw invalid("makeup_reservation_request_invalid")
  if (!supabase) throw invalid("makeup_client_missing")
  signal?.throwIfAborted()
  const deadline = AbortSignal.timeout(8_000)
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
  const { data, error } = await supabase.rpc("get_makeup_reservation_context_v1", { p_slots: slots.map(({ startAt, endAt }) => ({ startAt: new Date(startAt!).toISOString(), endAt: new Date(endAt!).toISOString() })), p_event_request_ids: eventRequestIds }).abortSignal(combined).retry(false)
  combined.throwIfAborted(); assertResult(error)
  if (!object(data) || !Array.isArray(data.reservations) || !data.reservations.every((row) => object(row) && isRawSlotsEnvelope(row) && uuid(row.id) && ["approval_pending", "manager_pending", "makeup_pending", "completed"].includes(String(row.status))
    && ["className", "makeupStartAt", "makeupEndAt", "makeupClassroom"].every((key) => typeof row[key] === "string") && Array.isArray(row.makeupSlots) && row.makeupSlots.every(isSlot))
    || !Array.isArray(data.activeEventRequestIds) || !data.activeEventRequestIds.every((id) => uuid(id) && eventRequestIds.some((requested) => requested.toLowerCase() === id.toLowerCase()))
    || !uniqueIds(data.activeEventRequestIds)
    || !uniqueIds(data.reservations.map((row) => row.id))) throw invalid("makeup_reservation_response_invalid")
  return { reservations: (data.reservations as MakeupReservation[]).map(normalizeWireSlots), activeEventRequestIds: data.activeEventRequestIds }
}
