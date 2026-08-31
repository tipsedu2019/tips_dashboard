import type { SupabaseClient } from "@supabase/supabase-js"
import { validatePageSize, type DataTablePageSize, type NumberedPage } from "../../lib/numbered-pagination.ts"
import { assertOpsTaskPageFilters, mapOpsTaskPageRow, type OpsTask, type OpsTaskPageFilters } from "./ops-task-service"

export type OpsTaskNumberedRequest = {
  filters: OpsTaskPageFilters
  page: number
  pageSize: DataTablePageSize
  viewerId: string
  signal?: AbortSignal
}

type Check = (value: unknown) => boolean
type Shape = Record<string, Check>
const string: Check = (value) => typeof value === "string"
const boolean: Check = (value) => typeof value === "boolean"
const uuid: Check = (value) => typeof value === "string" && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)
const number: Check = (value) => typeof value === "number" && Number.isFinite(value)
const count: Check = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0
const nullable = (check: Check): Check => (value) => value === null || check(value)
const oneOf = (...values: unknown[]): Check => (value) => values.includes(value)
const date: Check = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value && value.slice(0, 4) !== "0000"
const timestamp: Check = (value) => typeof value === "string" && date(value.slice(0, 10))
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) }
function fields(names: string, check: Check): Shape { return Object.fromEntries(names.split(" ").map((name) => [name, check])) }
function matches(value: unknown, shape: Shape): value is Record<string, unknown> {
  return object(value) && Object.keys(value).length === Object.keys(shape).length
    && Object.entries(shape).every(([key, check]) => Object.prototype.hasOwnProperty.call(value, key) && check(value[key]))
}
function readError(code: string) { return Object.assign(new Error(code), { code }) }

const COMMON: Shape = {
  id: uuid,
  ...fields("title requestedByLabel requestedTeam assigneeLabel assigneeTeam secondaryAssigneeLabel studentName className textbookTitle campus subject memo completedByLabel", string),
  ...fields("requestedById assigneeId secondaryAssigneeId studentId classId textbookId completedById", nullable(uuid)),
  ...fields("startAt dueAt completedAt", nullable(timestamp)),
  ...fields("createdAt updatedAt", timestamp),
  status: oneOf("requested", "confirmed", "in_progress", "review_requested", "done", "on_hold", "canceled"),
  priority: oneOf("low", "normal", "high", "urgent"),
  summaryFlags: (value) => Array.isArray(value) && value.every(string),
}
const REGISTRATION: Shape = {
  ...fields("pipelineStatus schoolGrade schoolName parentPhone studentPhone levelTestResult levelTestPlace levelTestMaterialLink counselor classStartSession requestNote", string),
  ...fields("inquiryAt levelTestAt levelTestCompletedAt phoneConsultationAt visitConsultationAt consultationAt", nullable(timestamp)),
  classStartDate: nullable(date),
}
const enrollment: Check = (value) => {
  if (!object(value) || !uuid(value.classId) || !count(value.sortOrder)) return false
  const optional: Shape = { id: uuid, textbookId: nullable(uuid), classStartDate: nullable(date), classStartSessionKey: nullable(string), classStartLessonSessionId: nullable(uuid), classStartSession: nullable(string), classStartSourceObservationId: nullable(uuid) }
  return Object.entries(value).every(([key, item]) => key === "classId" || key === "sortOrder" || (Object.prototype.hasOwnProperty.call(optional, key) && optional[key](item)))
}
const TRACK: Shape = {
  ...fields("id taskId", uuid), subject: oneOf("영어", "수학", "과학"),
  status: oneOf("inquiry", "migration_review", "level_test_scheduled", "level_test_in_progress", "consultation_waiting", "visit_consultation_scheduled", "waiting", "enrollment_decided", "enrollment_processing", "registered", "not_registered", "inquiry_closed"),
  workflowStatus: oneOf("inquiry", "level_test_requested", "consultation_requested", "consultation_completed", "waiting_current_class", "waiting_new_class", "waiting_next_opening", "enrollment_requested", "payment_in_progress", "registered", "not_registered", "inquiry_only", "observation_requested", "observation_feedback_pending", "observation_completed"),
  workflowRevision: (value) => count(value) && Number(value) > 0,
  ...fields("workflowStatusEnteredAt stageEnteredAt", timestamp), legacy: oneOf(false),
  ...fields("directorProfileId waitingDetailClassId observationCurrentId observationCurrentAppointmentId", nullable(uuid)),
  ...fields("directorName directorAssignmentRuleKey", string),
  directorAssignmentSource: oneOf("", "default", "manual", "migration"),
  ...fields("waitingKind waitingDetailKind", oneOf("", "current_class", "current_term_opening", "next_term_opening")),
  ...fields("waitingDetailRetakeDecision levelTestRetakeDecision", oneOf("", "required", "not_required")),
  enrollmentDetailRows: (value) => Array.isArray(value) && value.every(enrollment),
  ...fields("migrationReviewRequired observationSummaryVisible", boolean),
  ...fields("phoneReadyAt levelTestScheduledAt visitScheduledAt observationNearestScheduledAt", nullable(timestamp)),
  ...fields("levelTestPlace visitPlace", nullable(string)),
  phoneReadySource: oneOf(null, "inquiry", "level_test_completion", "visit_reopened", "director_resolved", "track_reopened", "migration", "legacy"),
  // The invoker summary view deliberately masks the entire observation tuple.
  ...fields("observationAttemptCount observationNotificationRevision observationRevision observationFeedbackRevision", nullable(count)),
  observationCurrentStatus: oneOf(null, "scheduled", "attended_feedback_pending", "completed", "no_show", "canceled"),
  observationNearestPlace: oneOf(null, "본관", "별관"),
}
const INLINE: Record<string, Shape> = {
  withdrawal: {
    ...fields("teacherName withdrawalSession customerReason teacherOpinion undistributedTextbooks", string), withdrawalDate: nullable(date),
    ...fields("completedLessonHours fourWeekLessonHours", nullable(number)), ...fields("makeeduWithdrawalDone feeProcessed textbookFeeProcessed", boolean),
  },
  transfer: {
    ...fields("fromClassId toClassId", nullable(uuid)), ...fields("fromClassEndDate toClassStartDate", nullable(date)),
    ...fields("fromTeacherName toTeacherName fromClassName toClassName fromClassEndSession toClassStartSession transferReason fromUndistributedTextbooks toUndistributedTextbooks", string),
    ...fields("makeeduTransferDone feeProcessed textbookFeeProcessed", boolean),
  },
  word_retest: {
    ...fields("retryOfTaskId retryTaskId teacherId", nullable(uuid)), ...fields("branch teacherName className studentName textbookName unit requestNote", string),
    ...fields("testAt expectedRetestAt", nullable(timestamp)), ...fields("totalQuestionCount cutoffQuestionCount firstScore secondScore thirdScore", nullable(number)),
    retestStatus: oneOf("not_started", "in_progress", "absent", "done"),
  },
}
const DISPLAY: Record<string, Shape> = {
  withdrawal: fields("status subject teacher className student withdrawalDate withdrawalSession completedLessonHours fourWeekLessonHours progress customerReason teacherOpinion undistributedTextbooks operationsChecklist", string),
  transfer: fields("status subject fromTeacher fromClassName student transferReason fromUndistributedTextbooks fromClassEndDate fromClassEndSession toTeacher toClassName toClassStartDate toClassStartSession toUndistributedTextbooks operationsChecklist", string),
  word_retest: fields("status testAt expectedRetestAt teacher class student textbook unit note total cutoff score result", string),
}
function validRow(value: unknown, taskType: OpsTaskPageFilters["taskType"]): value is Record<string, unknown> {
  const shape = { ...COMMON, type: taskType === "general" ? oneOf("general", "textbook") : oneOf(taskType) }
  if (taskType === "registration") {
    Object.assign(shape, { registration: (item: unknown) => matches(item, REGISTRATION), registrationTracks: (items: unknown) => Array.isArray(items)
      && items.every((item) => matches(item, TRACK) && object(value) && item.taskId === value.id)
      && new Set(items.map((item) => item.id)).size === items.length })
  } else if (Object.prototype.hasOwnProperty.call(INLINE, taskType)) {
    Object.assign(shape, { inlineState: (item: unknown) => matches(item, INLINE[taskType]), displayValues: (item: unknown) => matches(item, DISPLAY[taskType]) })
  }
  return matches(value, shape)
}
function validateRequest(request: OpsTaskNumberedRequest) {
  const invalid = () => { throw readError("ops_task_numbered_request_invalid") }
  if (!request || !Number.isInteger(request.page) || request.page < 1 || request.page > 2147483647 || typeof request.viewerId !== "string" || !request.viewerId.trim()) invalid()
  if (!object(request.filters) || typeof request.filters.taskType !== "string") invalid()
  try { validatePageSize(request.pageSize); assertOpsTaskPageFilters(request.filters) } catch { invalid() }
  const filters = request.filters
  if (filters.taskType === "withdrawal" || filters.taskType === "transfer" || filters.taskType === "word_retest") {
    if (typeof filters.period !== "string") invalid()
    const direction = filters.taskType === "word_retest" ? filters.tableSortDirection : filters.sortDirection
    if (direction !== null && direction !== "asc" && direction !== "desc") invalid()
    if (filters.period === "custom") {
      if (!date(filters.dateFrom) || !date(filters.dateTo) || filters.dateFrom! > filters.dateTo!) invalid()
    } else if (filters.dateFrom !== null || filters.dateTo !== null) invalid()
  }
}
function parsePage(data: unknown, request: OpsTaskNumberedRequest): NumberedPage<OpsTask> {
  if (!object(data) || data.page !== request.page || data.pageSize !== request.pageSize || !count(data.totalCount) || !Array.isArray(data.rows)
    || !data.rows.every((row) => validRow(row, request.filters.taskType))) throw readError("ops_task_numbered_response_invalid")
  const totalCount = data.totalCount as number
  const expectedLength = Math.min(request.pageSize, Math.max(0, totalCount - (request.page - 1) * request.pageSize))
  if (data.rows.length !== expectedLength || new Set(data.rows.map((row) => row.id)).size !== data.rows.length) throw readError("ops_task_numbered_response_invalid")
  return { rows: data.rows.map(mapOpsTaskPageRow), page: request.page, pageSize: request.pageSize, totalCount }
}
export function createOpsTaskNumberedReadService({ supabase }: { supabase: Pick<SupabaseClient, "rpc"> }) {
  return {
    async readPage(request: OpsTaskNumberedRequest): Promise<NumberedPage<OpsTask>> {
      validateRequest(request)
      request.signal?.throwIfAborted()
      const deadline = AbortSignal.timeout(8_000)
      const signal = request.signal ? AbortSignal.any([request.signal, deadline]) : deadline
      const { data, error } = await supabase.rpc("list_ops_task_numbered_page_v1", {
        p_type: request.filters.taskType, p_filters: request.filters, p_page: request.page, p_page_size: request.pageSize,
      }).abortSignal(signal).retry(false)
      signal.throwIfAborted()
      if (error) {
        if (error.code === "PGRST202" || error.code === "42883") throw Object.assign(readError("ops_task_numbered_rpc_unavailable"), { cause: error })
        throw error
      }
      return parsePage(data, request)
    },
  }
}
