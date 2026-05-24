import { supabase } from "@/lib/supabase"
import { ACTIVE_STUDENT_STATUS, WITHDRAWN_STUDENT_STATUS } from "@/lib/student-status.js"

import {
  REGISTRATION_PIPELINE_STATUSES,
  getOpsTaskCalendarItems,
  getTaskTypeLabel,
  summarizeOpsTasks,
} from "./ops-task-model"

export type OpsTaskType =
  | "registration"
  | "withdrawal"
  | "transfer"
  | "word_retest"
  | "textbook"
  | "general"

export type OpsTaskStatus =
  | "requested"
  | "confirmed"
  | "in_progress"
  | "done"
  | "on_hold"
  | "canceled"

export type OpsTaskPriority = "low" | "normal" | "high" | "urgent"

type Row = Record<string, unknown>
type OpsTaskLinkPatchValue = string | null
type OpsCompletionRollback = () => Promise<void>

export type OpsProfileOption = {
  id: string
  label: string
  email: string
  loginId: string
  role: string
}

export type OpsLinkedOption = {
  id: string
  label: string
  meta?: string
}

export type OpsStudentOption = OpsLinkedOption & {
  grade: string
  school: string
  contact: string
  parentContact: string
  status: string
  classIds: string[]
  waitlistClassIds: string[]
}

export type OpsClassOption = OpsLinkedOption & {
  subject: string
  grade: string
  teacher: string
  room: string
  studentIds: string[]
  waitlistIds: string[]
  textbookIds: string[]
}

export type OpsTextbookOption = OpsLinkedOption & {
  publisher: string
  subject: string
}

export type OpsTeacherOption = OpsLinkedOption & {
  subjects: string[]
  profileId: string
  accountEmail: string
  sortOrder: number
}

export type OpsRegistrationDetail = {
  pipelineStatus?: string
  inquiryChannel?: string
  inquiryAt?: string
  schoolGrade?: string
  schoolName?: string
  parentPhone?: string
  studentPhone?: string
  levelTestAt?: string
  levelTestPlace?: string
  levelTestMaterialLink?: string
  counselor?: string
  phoneConsultationAt?: string
  visitConsultationAt?: string
  consultationAt?: string
  classStartDate?: string
  classStartSession?: string
  textbookReady?: boolean
  admissionNoticeSent?: boolean
  paymentChecked?: boolean
  makeeduRegistered?: boolean
  makeeduInvoiceSent?: boolean
  textbookBillingIssued?: boolean
  requestNote?: string
}

export type OpsWithdrawalDetail = {
  schoolGrade?: string
  teacherName?: string
  withdrawalDate?: string
  withdrawalSession?: string
  customerReason?: string
  teacherOpinion?: string
  undistributedTextbooks?: string
  completedLessonHours?: string
  fourWeekLessonHours?: string
  timetableRosterUpdated?: boolean
  makeeduWithdrawalDone?: boolean
  feeProcessed?: boolean
  textbookFeeProcessed?: boolean
}

export type OpsTransferDetail = {
  transferReason?: string
  fromClassId?: string
  toClassId?: string
  fromTeacherName?: string
  toTeacherName?: string
  fromClassName?: string
  toClassName?: string
  fromClassEndDate?: string
  fromClassEndSession?: string
  toClassStartDate?: string
  toClassStartSession?: string
  fromUndistributedTextbooks?: string
  toUndistributedTextbooks?: string
  timetableRosterUpdated?: boolean
  makeeduTransferDone?: boolean
  feeProcessed?: boolean
  textbookFeeProcessed?: boolean
}

export type OpsWordRetestDetail = {
  branch?: string
  teacherId?: string
  teacherName?: string
  className?: string
  studentName?: string
  testAt?: string
  textbookName?: string
  unit?: string
  requestNote?: string
  firstScore?: string
  secondScore?: string
  thirdScore?: string
  retestStatus?: string
}

export type OpsTaskComment = {
  id: string
  taskId: string
  authorId: string
  authorLabel: string
  body: string
  createdAt: string
}

export type OpsTaskAttachment = {
  id: string
  taskId: string
  fileName: string
  fileKind: string
  driveFileId: string
  driveLink: string
  uploadedBy: string
  uploadedByLabel: string
  uploadedAt: string
}

export type OpsTaskEvent = {
  id: string
  taskId: string
  actorId: string
  actorLabel: string
  eventType: string
  fieldName: string
  beforeValue: string
  afterValue: string
  createdAt: string
}

export type OpsTask = {
  id: string
  title: string
  type: OpsTaskType
  status: OpsTaskStatus
  priority: OpsTaskPriority
  requestedBy: string
  requestedByLabel: string
  assigneeId: string
  assigneeLabel: string
  secondaryAssigneeId: string
  secondaryAssigneeLabel: string
  studentId: string
  studentName: string
  classId: string
  className: string
  textbookId: string
  textbookTitle: string
  campus: string
  subject: string
  dueAt: string
  completedAt: string
  memo: string
  createdAt: string
  updatedAt: string
  registration?: OpsRegistrationDetail
  withdrawal?: OpsWithdrawalDetail
  transfer?: OpsTransferDetail
  wordRetest?: OpsWordRetestDetail
  comments: OpsTaskComment[]
  attachments: OpsTaskAttachment[]
  events: OpsTaskEvent[]
}

export type OpsTaskWorkspaceData = {
  tasks: OpsTask[]
  profiles: OpsProfileOption[]
  students: OpsStudentOption[]
  classes: OpsClassOption[]
  textbooks: OpsTextbookOption[]
  teachers: OpsTeacherOption[]
  schemaReady: boolean
  error: string | null
}

export type OpsTaskInput = {
  title: string
  type: OpsTaskType
  status?: OpsTaskStatus
  priority?: OpsTaskPriority
  assigneeId?: string
  secondaryAssigneeId?: string
  studentId?: string
  classId?: string
  textbookId?: string
  studentName?: string
  className?: string
  textbookTitle?: string
  campus?: string
  subject?: string
  dueAt?: string
  completedAt?: string
  memo?: string
  registration?: OpsRegistrationDetail
  withdrawal?: OpsWithdrawalDetail
  transfer?: OpsTransferDetail
  wordRetest?: OpsWordRetestDetail
}

export const emptyOpsTaskWorkspaceData: OpsTaskWorkspaceData = {
  tasks: [],
  profiles: [],
  students: [],
  classes: [],
  textbooks: [],
  teachers: [],
  schemaReady: true,
  error: null,
}

const OPS_TASK_WORKSPACE_CACHE_TTL_MS = 15_000
type OpsTaskWorkspaceLoadOptions = {
  force?: boolean
  taskType?: OpsTaskType
  includeManagementOptions?: boolean
}
const opsTaskWorkspaceDataCache = new Map<string, { data: OpsTaskWorkspaceData; expiresAt: number }>()

function getOpsTaskWorkspaceCacheKey(options: OpsTaskWorkspaceLoadOptions = {}) {
  return [
    options.taskType || "all",
    options.includeManagementOptions === false ? "light" : "full",
  ].join(":")
}

function clearOpsTaskWorkspaceDataCache() {
  opsTaskWorkspaceDataCache.clear()
}

export function getCachedOpsTaskWorkspaceData(options: OpsTaskWorkspaceLoadOptions = {}) {
  const cached = opsTaskWorkspaceDataCache.get(getOpsTaskWorkspaceCacheKey(options))
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data
  }
  return null
}

function text(value: unknown) {
  return String(value || "").trim()
}

function bool(value: unknown) {
  return value === true
}

function numberText(value: unknown) {
  if (value === null || value === undefined || value === "") return ""
  return String(value)
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function nullable(value: unknown) {
  const trimmed = text(value)
  return trimmed ? trimmed : null
}

function nullableDate(value: unknown) {
  const trimmed = text(value)
  if (!trimmed) return null
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const date = new Date(trimmed)
    return Number.isNaN(date.getTime()) ? trimmed : date.toISOString()
  }
  return trimmed
}

function nullableNumber(value: unknown) {
  const trimmed = text(value)
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeIdList(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => text(item)).filter(Boolean))]
    : []
}

function addUniqueId(values: unknown, value: string) {
  const safeValue = text(value)
  const next = normalizeIdList(values)
  return safeValue && !next.includes(safeValue) ? [...next, safeValue] : next
}

function removeId(values: unknown, value: string) {
  const safeValue = text(value)
  return normalizeIdList(values).filter((item) => item !== safeValue)
}

function withoutOpsStudentClass(student: Row | null, classId: unknown) {
  if (!student) return student
  const safeClassId = text(classId)
  if (!safeClassId) return student

  return {
    ...student,
    class_ids: removeId(student.class_ids, safeClassId),
    waitlist_class_ids: removeId(student.waitlist_class_ids, safeClassId),
  }
}

function optionMeta(parts: unknown[]) {
  return parts.map(text).filter(Boolean).join(" · ")
}

function createOpsId() {
  if (globalThis.crypto && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID()
  }
  return `ops-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeStatus(value: unknown): OpsTaskStatus {
  const status = text(value) as OpsTaskStatus
  if (["requested", "confirmed", "in_progress", "done", "on_hold", "canceled"].includes(status)) {
    return status
  }
  return "requested"
}

function normalizeType(value: unknown): OpsTaskType {
  const type = text(value) as OpsTaskType
  if (["registration", "withdrawal", "transfer", "word_retest", "textbook", "general"].includes(type)) {
    return type
  }
  return "general"
}

function normalizePriority(value: unknown): OpsTaskPriority {
  const priority = text(value) as OpsTaskPriority
  if (["low", "normal", "high", "urgent"].includes(priority)) {
    return priority
  }
  return "normal"
}

function isMissingRelationError(error: unknown) {
  const code = typeof error === "object" && error ? text((error as { code?: string }).code) : ""
  const message = error instanceof Error ? error.message : text((error as { message?: string })?.message)

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("Could not find the table")
  )
}

function isMissingColumnError(error: unknown) {
  const code = typeof error === "object" && error ? text((error as { code?: string }).code) : ""
  const message = error instanceof Error ? error.message : text((error as { message?: string })?.message)
  return code === "42703" || code === "PGRST204" || message.includes("Could not find") || message.includes("column")
}

function profileLabel(profile: Row | undefined) {
  if (!profile) return ""
  return text(profile.name) || text(profile.email) || text(profile.login_id) || text(profile.id)
}

function profileSecondaryLabel(profile: Row) {
  return text(profile.email) || text(profile.login_id) || text(profile.role)
}

function profileOptionLabel(profile: Row, duplicatedLabels: Set<string>) {
  const label = profileLabel(profile)
  if (!duplicatedLabels.has(label)) return label

  const secondaryLabel = profileSecondaryLabel(profile)
  return secondaryLabel && secondaryLabel !== label ? `${label} · ${secondaryLabel}` : label
}

function buildProfileLookup(profiles: Row[]) {
  return new Map(profiles.map((profile) => [text(profile.id), profile]))
}

function byTaskId<T extends { taskId: string }>(items: T[]) {
  const map = new Map<string, T[]>()
  items.forEach((item) => {
    const list = map.get(item.taskId) || []
    list.push(item)
    map.set(item.taskId, list)
  })
  return map
}

function singleByTaskId<T extends { taskId: string }>(items: T[]) {
  return new Map(items.map((item) => [item.taskId, item]))
}

async function readTable(table: string, columns = "*", optional = true) {
  if (!supabase) return []

  const result = await supabase.from(table).select(columns)
  if (result.error) {
    if (optional || isMissingRelationError(result.error)) return []
    throw result.error
  }

  return (result.data || []) as unknown as Row[]
}

async function readTableWithFallback(table: string, columns: string, fallbackColumns: string, optional = true) {
  if (!supabase) return []

  const result = await supabase.from(table).select(columns)
  if (!result.error) {
    return (result.data || []) as unknown as Row[]
  }

  if (fallbackColumns && isMissingColumnError(result.error)) {
    const fallback = await supabase.from(table).select(fallbackColumns)
    if (!fallback.error) {
      return (fallback.data || []) as unknown as Row[]
    }
    if (optional || isMissingRelationError(fallback.error)) return []
    throw fallback.error
  }

  if (optional || isMissingRelationError(result.error)) return []
  throw result.error
}

async function readTaskScopedTable(table: string, taskIds: string[], columns = "*", optional = true) {
  if (!supabase || taskIds.length === 0) return []

  const result = await supabase.from(table).select(columns).in("task_id", taskIds)
  if (result.error) {
    if (optional || isMissingRelationError(result.error)) return []
    throw result.error
  }

  return (result.data || []) as unknown as Row[]
}

async function writeEvent(taskId: string, eventType: string, fieldName = "", beforeValue = "", afterValue = "") {
  if (!supabase) return
  const { error } = await supabase.from("ops_task_events").insert({
    task_id: taskId,
    event_type: eventType,
    field_name: nullable(fieldName),
    before_value: nullable(beforeValue),
    after_value: nullable(afterValue),
  })
  if (error && !isMissingRelationError(error) && !isMissingColumnError(error)) throw error
}

async function writeAutoSyncEventOnce(taskId: string, fieldName: string, afterValue: string, beforeValue = "") {
  if (!supabase || !text(taskId) || !text(fieldName) || !text(afterValue)) return

  const { data, error } = await supabase
    .from("ops_task_events")
    .select("id")
    .eq("task_id", taskId)
    .eq("event_type", "auto_synced")
    .eq("field_name", fieldName)
    .eq("after_value", afterValue)
    .limit(1)

  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) return
    throw error
  }
  if ((data || []).length > 0) return

  await writeEvent(taskId, "auto_synced", fieldName, beforeValue, afterValue)
}

type ManualCheckFieldDefinition = {
  column: string
  label: string
  getValue: (input: OpsTaskInput) => boolean
}

const MANUAL_CHECK_FIELD_DEFINITIONS: Partial<Record<OpsTaskType, { table: string; fields: ManualCheckFieldDefinition[] }>> = {
  registration: {
    table: "ops_registration_details",
    fields: [
      { column: "admission_notice_sent", label: "입학안내문", getValue: (input) => Boolean(input.registration?.admissionNoticeSent) },
      { column: "payment_checked", label: "수납", getValue: (input) => Boolean(input.registration?.paymentChecked) },
      { column: "makeedu_registered", label: "메이크에듀 등록", getValue: (input) => Boolean(input.registration?.makeeduRegistered) },
      { column: "makeedu_invoice_sent", label: "청구서 발송", getValue: (input) => Boolean(input.registration?.makeeduInvoiceSent) },
      { column: "textbook_billing_issued", label: "교재 청구출고표", getValue: (input) => Boolean(input.registration?.textbookBillingIssued) },
    ],
  },
  withdrawal: {
    table: "ops_withdrawal_details",
    fields: [
      { column: "makeedu_withdrawal_done", label: "메이크에듀 퇴원처리", getValue: (input) => Boolean(input.withdrawal?.makeeduWithdrawalDone) },
      { column: "fee_processed", label: "수업료 처리", getValue: (input) => Boolean(input.withdrawal?.feeProcessed) },
      { column: "textbook_fee_processed", label: "교재비 처리", getValue: (input) => Boolean(input.withdrawal?.textbookFeeProcessed) },
    ],
  },
  transfer: {
    table: "ops_transfer_details",
    fields: [
      { column: "makeedu_transfer_done", label: "메이크에듀 전반처리", getValue: (input) => Boolean(input.transfer?.makeeduTransferDone) },
      { column: "fee_processed", label: "수업료 처리", getValue: (input) => Boolean(input.transfer?.feeProcessed) },
      { column: "textbook_fee_processed", label: "교재비 처리", getValue: (input) => Boolean(input.transfer?.textbookFeeProcessed) },
    ],
  },
}

async function writeManualCheckEvents(taskId: string, input: OpsTaskInput) {
  if (!supabase) return
  const definition = MANUAL_CHECK_FIELD_DEFINITIONS[input.type]
  if (!definition) return

  const { data, error } = await supabase
    .from(definition.table)
    .select(definition.fields.map((field) => field.column).join(","))
    .eq("task_id", taskId)
    .maybeSingle()

  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) return
    throw error
  }

  const previous = (data || {}) as Row
  for (const field of definition.fields) {
    const previousChecked = bool(previous[field.column])
    const nextChecked = field.getValue(input)
    if (previousChecked === nextChecked) continue
    await writeEvent(taskId, nextChecked ? "manual_checked" : "manual_unchecked", field.label, previousChecked ? "완료" : "", nextChecked ? "완료" : "")
  }
}

function mapRegistration(row: Row | undefined): OpsRegistrationDetail | undefined {
  if (!row) return undefined
  return {
    pipelineStatus: text(row.pipeline_status) || REGISTRATION_PIPELINE_STATUSES[0]?.value || "0. 등록 문의",
    inquiryChannel: text(row.inquiry_channel),
    inquiryAt: text(row.inquiry_at),
    schoolGrade: text(row.school_grade),
    schoolName: text(row.school_name),
    parentPhone: text(row.parent_phone),
    studentPhone: text(row.student_phone),
    levelTestAt: text(row.level_test_at),
    levelTestPlace: text(row.level_test_place),
    levelTestMaterialLink: text(row.level_test_material_link),
    counselor: text(row.counselor),
    phoneConsultationAt: text(row.phone_consultation_at),
    visitConsultationAt: text(row.visit_consultation_at),
    consultationAt: text(row.consultation_at),
    classStartDate: text(row.class_start_date),
    classStartSession: text(row.class_start_session),
    textbookReady: bool(row.textbook_ready),
    admissionNoticeSent: bool(row.admission_notice_sent),
    paymentChecked: bool(row.payment_checked),
    makeeduRegistered: bool(row.makeedu_registered),
    makeeduInvoiceSent: bool(row.makeedu_invoice_sent),
    textbookBillingIssued: bool(row.textbook_billing_issued),
    requestNote: text(row.request_note),
  }
}

function mapWithdrawal(row: Row | undefined): OpsWithdrawalDetail | undefined {
  if (!row) return undefined
  return {
    schoolGrade: text(row.school_grade),
    teacherName: text(row.teacher_name),
    withdrawalDate: text(row.withdrawal_date),
    withdrawalSession: text(row.withdrawal_session),
    customerReason: text(row.customer_reason),
    teacherOpinion: text(row.teacher_opinion),
    undistributedTextbooks: text(row.undistributed_textbooks),
    completedLessonHours: numberText(row.completed_lesson_hours),
    fourWeekLessonHours: numberText(row.four_week_lesson_hours),
    timetableRosterUpdated: bool(row.timetable_roster_updated),
    makeeduWithdrawalDone: bool(row.makeedu_withdrawal_done),
    feeProcessed: bool(row.fee_processed),
    textbookFeeProcessed: bool(row.textbook_fee_processed),
  }
}

function mapTransfer(row: Row | undefined): OpsTransferDetail | undefined {
  if (!row) return undefined
  return {
    transferReason: text(row.transfer_reason),
    fromClassId: text(row.from_class_id),
    toClassId: text(row.to_class_id),
    fromTeacherName: text(row.from_teacher_name),
    toTeacherName: text(row.to_teacher_name),
    fromClassName: text(row.from_class_name),
    toClassName: text(row.to_class_name),
    fromClassEndDate: text(row.from_class_end_date),
    fromClassEndSession: text(row.from_class_end_session),
    toClassStartDate: text(row.to_class_start_date),
    toClassStartSession: text(row.to_class_start_session),
    fromUndistributedTextbooks: text(row.from_undistributed_textbooks),
    toUndistributedTextbooks: text(row.to_undistributed_textbooks),
    timetableRosterUpdated: bool(row.timetable_roster_updated),
    makeeduTransferDone: bool(row.makeedu_transfer_done),
    feeProcessed: bool(row.fee_processed),
    textbookFeeProcessed: bool(row.textbook_fee_processed),
  }
}

function mapWordRetest(row: Row | undefined): OpsWordRetestDetail | undefined {
  if (!row) return undefined
  return {
    branch: text(row.branch),
    teacherId: text(row.teacher_catalog_id),
    teacherName: text(row.teacher_name),
    className: text(row.class_name),
    studentName: text(row.student_name),
    testAt: text(row.test_at),
    textbookName: text(row.textbook_name),
    unit: text(row.unit),
    requestNote: text(row.request_note),
    firstScore: numberText(row.first_score),
    secondScore: numberText(row.second_score),
    thirdScore: numberText(row.third_score),
    retestStatus: text(row.retest_status),
  }
}

function mapComment(row: Row, profiles: Map<string, Row>): OpsTaskComment {
  const authorId = text(row.author_id)
  return {
    id: text(row.id),
    taskId: text(row.task_id),
    authorId,
    authorLabel: profileLabel(profiles.get(authorId)),
    body: text(row.body),
    createdAt: text(row.created_at),
  }
}

function mapAttachment(row: Row, profiles: Map<string, Row>): OpsTaskAttachment {
  const uploadedBy = text(row.uploaded_by)
  return {
    id: text(row.id),
    taskId: text(row.task_id),
    fileName: text(row.file_name),
    fileKind: text(row.file_kind),
    driveFileId: text(row.drive_file_id),
    driveLink: text(row.drive_link),
    uploadedBy,
    uploadedByLabel: profileLabel(profiles.get(uploadedBy)),
    uploadedAt: text(row.uploaded_at),
  }
}

function mapEvent(row: Row, profiles: Map<string, Row>): OpsTaskEvent {
  const actorId = text(row.actor_id)
  return {
    id: text(row.id),
    taskId: text(row.task_id),
    actorId,
    actorLabel: profileLabel(profiles.get(actorId)),
    eventType: text(row.event_type),
    fieldName: text(row.field_name),
    beforeValue: text(row.before_value),
    afterValue: text(row.after_value),
    createdAt: text(row.created_at),
  }
}

function mapTask(
  row: Row,
  profiles: Map<string, Row>,
  registration: Map<string, OpsRegistrationDetail>,
  withdrawal: Map<string, OpsWithdrawalDetail>,
  transfer: Map<string, OpsTransferDetail>,
  wordRetest: Map<string, OpsWordRetestDetail>,
  comments: Map<string, OpsTaskComment[]>,
  attachments: Map<string, OpsTaskAttachment[]>,
  events: Map<string, OpsTaskEvent[]>,
): OpsTask {
  const id = text(row.id)
  const requestedBy = text(row.requested_by)
  const assigneeId = text(row.assignee_id)
  const secondaryAssigneeId = text(row.secondary_assignee_id)

  return {
    id,
    title: text(row.title),
    type: normalizeType(row.type),
    status: normalizeStatus(row.status),
    priority: normalizePriority(row.priority),
    requestedBy,
    requestedByLabel: profileLabel(profiles.get(requestedBy)),
    assigneeId,
    assigneeLabel: profileLabel(profiles.get(assigneeId)),
    secondaryAssigneeId,
    secondaryAssigneeLabel: profileLabel(profiles.get(secondaryAssigneeId)),
    studentId: text(row.student_id),
    studentName: text(row.student_name),
    classId: text(row.class_id),
    className: text(row.class_name),
    textbookId: text(row.textbook_id),
    textbookTitle: text(row.textbook_title),
    campus: text(row.campus),
    subject: text(row.subject),
    dueAt: text(row.due_at),
    completedAt: text(row.completed_at),
    memo: text(row.memo),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    registration: registration.get(id),
    withdrawal: withdrawal.get(id),
    transfer: transfer.get(id),
    wordRetest: wordRetest.get(id),
    comments: comments.get(id) || [],
    attachments: attachments.get(id) || [],
    events: events.get(id) || [],
  }
}

export type OpsTodoDashboardSummaryData = {
  tasks: OpsTask[]
  schemaReady: boolean
  error: string | null
}

export async function loadOpsTodoDashboardSummaryData(): Promise<OpsTodoDashboardSummaryData> {
  if (!supabase) {
    return {
      tasks: [],
      schemaReady: false,
      error: "Supabase 연결 설정이 필요합니다.",
    }
  }

  try {
    const [taskResult, profileRows] = await Promise.all([
      supabase
        .from("ops_tasks")
        .select("id,title,type,status,priority,requested_by,assignee_id,secondary_assignee_id,student_id,class_id,textbook_id,student_name,class_name,textbook_title,campus,subject,due_at,completed_at,memo,created_at,updated_at")
        .eq("type", "general")
        .not("status", "in", "(\"done\",\"canceled\")"),
      readTable("profiles", "id,name,email,role,login_id", true),
    ])

    if (taskResult.error) throw taskResult.error

    const profiles = buildProfileLookup(profileRows)
    const emptyRegistration = new Map<string, OpsRegistrationDetail>()
    const emptyWithdrawal = new Map<string, OpsWithdrawalDetail>()
    const emptyTransfer = new Map<string, OpsTransferDetail>()
    const emptyWordRetest = new Map<string, OpsWordRetestDetail>()
    const emptyComments = new Map<string, OpsTaskComment[]>()
    const emptyAttachments = new Map<string, OpsTaskAttachment[]>()
    const emptyEvents = new Map<string, OpsTaskEvent[]>()
    const tasks = ((taskResult.data || []) as unknown as Row[])
      .map((row) => mapTask(
        row,
        profiles,
        emptyRegistration,
        emptyWithdrawal,
        emptyTransfer,
        emptyWordRetest,
        emptyComments,
        emptyAttachments,
        emptyEvents,
      ))
      .sort((left, right) => (
        String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt))
      ))

    return {
      tasks,
      schemaReady: true,
      error: null,
    }
  } catch (error) {
    if (isMissingRelationError(error)) {
      return {
        tasks: [],
        schemaReady: false,
        error: "업무 DB 마이그레이션을 적용한 뒤 새로고침하세요.",
      }
    }

    return {
      tasks: [],
      schemaReady: false,
      error: error instanceof Error ? error.message : "할 일 요약을 불러오지 못했습니다.",
    }
  }
}

export async function loadOpsTaskWorkspaceData(options: OpsTaskWorkspaceLoadOptions = {}): Promise<OpsTaskWorkspaceData> {
  const cacheKey = getOpsTaskWorkspaceCacheKey(options)
  const cached = opsTaskWorkspaceDataCache.get(cacheKey)
  if (!options.force && cached && cached.expiresAt > Date.now()) {
    return cached.data
  }

  if (!supabase) {
    return {
      ...emptyOpsTaskWorkspaceData,
      schemaReady: false,
      error: "Supabase 연결 설정이 필요합니다.",
    }
  }

  try {
    let taskQuery = supabase.from("ops_tasks").select("*")
    if (options.taskType) taskQuery = taskQuery.eq("type", options.taskType)
    const taskReadPromise = taskQuery.then(({ data, error }) => {
      if (error) throw error
      return (data || []) as unknown as Row[]
    })
    const includeManagementOptions = options.includeManagementOptions !== false
    const [
      taskRows,
      profileRows,
      studentRows,
      classRows,
      textbookRows,
      teacherRows,
    ] = await Promise.all([
      taskReadPromise,
      readTable("profiles", "id,name,email,role,login_id", true),
      includeManagementOptions
        ? readTableWithFallback("students", "id,name,grade,school,contact,parent_contact,status,class_ids,waitlist_class_ids", "id,name,grade,school,contact,parent_contact,status", true)
        : Promise.resolve([]),
      includeManagementOptions
        ? readTableWithFallback("classes", "id,name,subject,grade,teacher,room,student_ids,waitlist_ids,textbook_ids,status", "id,name,subject,grade,teacher,room,student_ids,waitlist_ids", true)
        : Promise.resolve([]),
      includeManagementOptions
        ? readTable("textbooks", "id,title,name,publisher,subject", true)
        : Promise.resolve([]),
      includeManagementOptions
        ? readTableWithFallback("teacher_catalogs", "id,name,subjects,is_visible,sort_order,profile_id,account_email", "id,name,subjects,is_visible,sort_order", true)
        : Promise.resolve([]),
    ])

    const taskIds = taskRows.map((row) => text(row.id)).filter(Boolean)
    const shouldReadRegistration = !options.taskType || options.taskType === "registration"
    const shouldReadWithdrawal = !options.taskType || options.taskType === "withdrawal"
    const shouldReadTransfer = !options.taskType || options.taskType === "transfer"
    const shouldReadWordRetest = !options.taskType || options.taskType === "word_retest"
    const [
      registrationRows,
      withdrawalRows,
      transferRows,
      wordRetestRows,
      commentRows,
      attachmentRows,
      eventRows,
    ] = await Promise.all([
      shouldReadRegistration ? readTaskScopedTable("ops_registration_details", taskIds) : Promise.resolve([]),
      shouldReadWithdrawal ? readTaskScopedTable("ops_withdrawal_details", taskIds) : Promise.resolve([]),
      shouldReadTransfer ? readTaskScopedTable("ops_transfer_details", taskIds) : Promise.resolve([]),
      shouldReadWordRetest ? readTaskScopedTable("ops_word_retests", taskIds) : Promise.resolve([]),
      readTaskScopedTable("ops_task_comments", taskIds),
      readTaskScopedTable("ops_task_attachments", taskIds),
      readTaskScopedTable("ops_task_events", taskIds),
    ])

    const profiles = buildProfileLookup(profileRows)
    const comments = byTaskId(commentRows.map((row) => mapComment(row, profiles)))
    const attachments = byTaskId(attachmentRows.map((row) => mapAttachment(row, profiles)))
    const events = byTaskId(eventRows.map((row) => mapEvent(row, profiles)))
    const registration = singleByTaskId(registrationRows.map((row) => ({
      taskId: text(row.task_id),
      ...mapRegistration(row)!,
    })))
    const withdrawal = singleByTaskId(withdrawalRows.map((row) => ({
      taskId: text(row.task_id),
      ...mapWithdrawal(row)!,
    })))
    const transfer = singleByTaskId(transferRows.map((row) => ({
      taskId: text(row.task_id),
      ...mapTransfer(row)!,
    })))
    const wordRetest = singleByTaskId(wordRetestRows.map((row) => ({
      taskId: text(row.task_id),
      ...mapWordRetest(row)!,
    })))

    const profileLabelCounts = new Map<string, number>()
    profileRows.forEach((row) => {
      const label = profileLabel(row)
      profileLabelCounts.set(label, (profileLabelCounts.get(label) || 0) + 1)
    })
    const duplicatedProfileLabels = new Set(
      Array.from(profileLabelCounts.entries())
        .filter(([, count]) => count > 1)
        .map(([label]) => label),
    )

    const data = {
      tasks: taskRows
        .map((row) => mapTask(row, profiles, registration, withdrawal, transfer, wordRetest, comments, attachments, events))
        .sort((left, right) => (
          String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt))
        )),
      profiles: profileRows
        .map((row) => ({
          id: text(row.id),
          label: profileOptionLabel(row, duplicatedProfileLabels),
          email: text(row.email),
          loginId: text(row.login_id),
          role: text(row.role),
        }))
        .sort((left, right) => left.label.localeCompare(right.label, "ko")),
      students: studentRows.map((row) => ({
        id: text(row.id),
        label: text(row.name) || text(row.id),
        meta: optionMeta([row.grade, row.school, row.status]),
        grade: text(row.grade),
        school: text(row.school),
        contact: text(row.contact),
        parentContact: text(row.parent_contact),
        status: text(row.status),
        classIds: normalizeIdList(row.class_ids),
        waitlistClassIds: normalizeIdList(row.waitlist_class_ids),
      } satisfies OpsStudentOption)),
      classes: classRows.map((row) => ({
        id: text(row.id),
        label: text(row.name) || text(row.id),
        meta: optionMeta([row.subject, row.teacher, row.room]),
        subject: text(row.subject),
        grade: text(row.grade),
        teacher: text(row.teacher),
        room: text(row.room),
        studentIds: normalizeIdList(row.student_ids),
        waitlistIds: normalizeIdList(row.waitlist_ids),
        textbookIds: normalizeIdList(row.textbook_ids),
      } satisfies OpsClassOption)),
      textbooks: textbookRows.map((row) => ({
        id: text(row.id),
        label: text(row.title) || text(row.name) || text(row.id),
        meta: optionMeta([row.publisher, row.subject]),
        publisher: text(row.publisher),
        subject: text(row.subject),
      } satisfies OpsTextbookOption)),
      teachers: teacherRows
        .filter((row) => row.is_visible !== false)
        .map((row) => ({
          id: text(row.id),
          label: text(row.name) || text(row.id),
          meta: optionMeta([Array.isArray(row.subjects) ? row.subjects.join(", ") : "", row.account_email]),
          subjects: Array.isArray(row.subjects) ? row.subjects.map((subject) => text(subject)).filter(Boolean) : [],
          profileId: text(row.profile_id),
          accountEmail: text(row.account_email),
          sortOrder: numberValue(row.sort_order),
        } satisfies OpsTeacherOption))
        .sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, "ko")),
      schemaReady: true,
      error: null,
    }
    opsTaskWorkspaceDataCache.set(cacheKey, {
      data,
      expiresAt: Date.now() + OPS_TASK_WORKSPACE_CACHE_TTL_MS,
    })
    return data
  } catch (error) {
    if (isMissingRelationError(error)) {
      return {
        ...emptyOpsTaskWorkspaceData,
        schemaReady: false,
        error: "할 일 DB 마이그레이션을 적용한 뒤 새로고침하세요.",
      }
    }

    return {
      ...emptyOpsTaskWorkspaceData,
      schemaReady: false,
      error: error instanceof Error ? error.message : "할 일 데이터를 불러오지 못했습니다.",
    }
  }
}

export async function loadOpsTaskById(taskId: string): Promise<OpsTask | null> {
  if (!supabase || !text(taskId)) return null

  const taskResult = await supabase.from("ops_tasks").select("*").eq("id", taskId).limit(1)
  if (taskResult.error) {
    if (isMissingRelationError(taskResult.error)) return null
    throw taskResult.error
  }

  const taskRows = (taskResult.data || []) as unknown as Row[]
  if (taskRows.length === 0) return null

  const taskIds = [taskId]
  const [
    profileRows,
    registrationRows,
    withdrawalRows,
    transferRows,
    wordRetestRows,
    commentRows,
    attachmentRows,
    eventRows,
  ] = await Promise.all([
    readTable("profiles", "id,name,email,role,login_id", true),
    readTaskScopedTable("ops_registration_details", taskIds),
    readTaskScopedTable("ops_withdrawal_details", taskIds),
    readTaskScopedTable("ops_transfer_details", taskIds),
    readTaskScopedTable("ops_word_retests", taskIds),
    readTaskScopedTable("ops_task_comments", taskIds),
    readTaskScopedTable("ops_task_attachments", taskIds),
    readTaskScopedTable("ops_task_events", taskIds),
  ])

  const profiles = buildProfileLookup(profileRows)
  const comments = byTaskId(commentRows.map((row) => mapComment(row, profiles)))
  const attachments = byTaskId(attachmentRows.map((row) => mapAttachment(row, profiles)))
  const events = byTaskId(eventRows.map((row) => mapEvent(row, profiles)))
  const registration = singleByTaskId(registrationRows.map((row) => ({
    taskId: text(row.task_id),
    ...mapRegistration(row)!,
  })))
  const withdrawal = singleByTaskId(withdrawalRows.map((row) => ({
    taskId: text(row.task_id),
    ...mapWithdrawal(row)!,
  })))
  const transfer = singleByTaskId(transferRows.map((row) => ({
    taskId: text(row.task_id),
    ...mapTransfer(row)!,
  })))
  const wordRetest = singleByTaskId(wordRetestRows.map((row) => ({
    taskId: text(row.task_id),
    ...mapWordRetest(row)!,
  })))

  return mapTask(taskRows[0], profiles, registration, withdrawal, transfer, wordRetest, comments, attachments, events)
}

async function assertOpsTaskExists(taskId: string) {
  if (!supabase || !text(taskId)) throw new Error("업무 데이터를 다시 불러오세요.")

  const { data, error } = await supabase.from("ops_tasks").select("id").eq("id", taskId).limit(1)
  if (error) throw error
  if (((data || []) as unknown as Row[]).length === 0) throw new Error("업무 데이터를 다시 불러오세요.")
}

function isMissingOpsTaskReferenceError(error: unknown) {
  const code = typeof error === "object" && error ? text((error as { code?: string }).code) : ""
  const message = (error instanceof Error ? error.message : text((error as { message?: string })?.message)).toLowerCase()
  return code === "23503" || (message.includes("foreign key") && message.includes("ops_tasks"))
}

function throwIfMissingOpsTaskReference(error: unknown): never {
  if (isMissingOpsTaskReferenceError(error)) throw new Error("업무 데이터를 다시 불러오세요.")
  throw error
}

function didMutateOpsTask(data: unknown) {
  return ((data || []) as unknown as Row[]).length > 0
}

function buildTaskRow(input: OpsTaskInput, options: { preserveManagementLinks?: boolean; completedAtFallback?: string } = {}) {
  const completedAt = nullableDate(input.completedAt) || (input.status === "done" ? nullableDate(options.completedAtFallback) : null)
  const row = {
    title: input.title,
    type: input.type,
    status: input.status || "requested",
    priority: input.priority || "normal",
    assignee_id: nullable(input.assigneeId),
    secondary_assignee_id: nullable(input.secondaryAssigneeId),
    student_id: nullable(input.studentId),
    class_id: nullable(input.classId),
    textbook_id: nullable(input.textbookId),
    student_name: nullable(input.studentName),
    class_name: nullable(input.className),
    textbook_title: nullable(input.textbookTitle),
    campus: nullable(input.campus),
    subject: nullable(input.subject),
    due_at: nullableDate(input.dueAt),
    completed_at: completedAt,
    memo: nullable(input.memo),
  }
  if (!options.preserveManagementLinks) return row

  const managementLinkColumns = new Set([
    "assignee_id",
    "student_id",
    "class_id",
    "textbook_id",
    "student_name",
    "class_name",
    "textbook_title",
    "subject",
  ])
  const rowWithoutManagementLinks = Object.fromEntries(
    Object.entries(row).filter(([column]) => !managementLinkColumns.has(column)),
  )
  return rowWithoutManagementLinks
}

function buildRegistrationRow(taskId: string, detail: OpsRegistrationDetail = {}) {
  return {
    task_id: taskId,
    pipeline_status: nullable(detail.pipelineStatus) || REGISTRATION_PIPELINE_STATUSES[0]?.value || "0. 등록 문의",
    inquiry_channel: nullable(detail.inquiryChannel),
    inquiry_at: nullableDate(detail.inquiryAt),
    school_grade: nullable(detail.schoolGrade),
    school_name: nullable(detail.schoolName),
    parent_phone: nullable(detail.parentPhone),
    student_phone: nullable(detail.studentPhone),
    level_test_at: nullableDate(detail.levelTestAt),
    level_test_place: nullable(detail.levelTestPlace),
    level_test_material_link: nullable(detail.levelTestMaterialLink),
    counselor: nullable(detail.counselor),
    phone_consultation_at: nullableDate(detail.phoneConsultationAt),
    visit_consultation_at: nullableDate(detail.visitConsultationAt),
    consultation_at: nullableDate(detail.consultationAt),
    class_start_date: nullableDate(detail.classStartDate),
    class_start_session: nullable(detail.classStartSession),
    textbook_ready: Boolean(detail.textbookReady),
    admission_notice_sent: Boolean(detail.admissionNoticeSent),
    payment_checked: Boolean(detail.paymentChecked),
    makeedu_registered: Boolean(detail.makeeduRegistered),
    makeedu_invoice_sent: Boolean(detail.makeeduInvoiceSent),
    textbook_billing_issued: Boolean(detail.textbookBillingIssued),
    request_note: nullable(detail.requestNote),
  }
}

function buildWithdrawalRow(taskId: string, detail: OpsWithdrawalDetail = {}) {
  return {
    task_id: taskId,
    school_grade: nullable(detail.schoolGrade),
    teacher_name: nullable(detail.teacherName),
    withdrawal_date: nullableDate(detail.withdrawalDate),
    withdrawal_session: nullable(detail.withdrawalSession),
    customer_reason: nullable(detail.customerReason),
    teacher_opinion: nullable(detail.teacherOpinion),
    undistributed_textbooks: nullable(detail.undistributedTextbooks),
    completed_lesson_hours: nullableNumber(detail.completedLessonHours),
    four_week_lesson_hours: nullableNumber(detail.fourWeekLessonHours),
    timetable_roster_updated: Boolean(detail.timetableRosterUpdated),
    makeedu_withdrawal_done: Boolean(detail.makeeduWithdrawalDone),
    fee_processed: Boolean(detail.feeProcessed),
    textbook_fee_processed: Boolean(detail.textbookFeeProcessed),
  }
}

function buildTransferRow(taskId: string, detail: OpsTransferDetail = {}) {
  return {
    task_id: taskId,
    transfer_reason: nullable(detail.transferReason),
    from_class_id: nullable(detail.fromClassId),
    to_class_id: nullable(detail.toClassId),
    from_teacher_name: nullable(detail.fromTeacherName),
    to_teacher_name: nullable(detail.toTeacherName),
    from_class_name: nullable(detail.fromClassName),
    to_class_name: nullable(detail.toClassName),
    from_class_end_date: nullableDate(detail.fromClassEndDate),
    from_class_end_session: nullable(detail.fromClassEndSession),
    to_class_start_date: nullableDate(detail.toClassStartDate),
    to_class_start_session: nullable(detail.toClassStartSession),
    from_undistributed_textbooks: nullable(detail.fromUndistributedTextbooks),
    to_undistributed_textbooks: nullable(detail.toUndistributedTextbooks),
    timetable_roster_updated: Boolean(detail.timetableRosterUpdated),
    makeedu_transfer_done: Boolean(detail.makeeduTransferDone),
    fee_processed: Boolean(detail.feeProcessed),
    textbook_fee_processed: Boolean(detail.textbookFeeProcessed),
  }
}

function buildWordRetestRow(taskId: string, detail: OpsWordRetestDetail = {}) {
  return {
    task_id: taskId,
    branch: nullable(detail.branch) || "본관",
    teacher_catalog_id: nullable(detail.teacherId),
    teacher_name: nullable(detail.teacherName),
    class_name: nullable(detail.className),
    student_name: nullable(detail.studentName),
    test_at: nullableDate(detail.testAt),
    textbook_name: nullable(detail.textbookName),
    unit: nullable(detail.unit),
    request_note: nullable(detail.requestNote),
    first_score: nullableNumber(detail.firstScore),
    second_score: nullableNumber(detail.secondScore),
    third_score: nullableNumber(detail.thirdScore),
    retest_status: nullable(detail.retestStatus) || "not_started",
  }
}

function stripMissingMigrationColumns(row: Row, columns: string[]) {
  const next = { ...row }
  columns.forEach((column) => {
    delete next[column]
  })
  return next
}

async function upsertDetail(taskId: string, input: OpsTaskInput) {
  if (!supabase) return

  if (input.type === "registration") {
    const { error } = await supabase.from("ops_registration_details").upsert(buildRegistrationRow(taskId, input.registration))
    if (error) throw error
  }
  if (input.type === "withdrawal") {
    const { error } = await supabase.from("ops_withdrawal_details").upsert(buildWithdrawalRow(taskId, input.withdrawal))
    if (error) throw error
  }
  if (input.type === "transfer") {
    const row = buildTransferRow(taskId, input.transfer)
    let { error } = await supabase.from("ops_transfer_details").upsert(row)
    if (error && isMissingColumnError(error)) {
      ;({ error } = await supabase
        .from("ops_transfer_details")
        .upsert(stripMissingMigrationColumns(row, ["from_class_id", "to_class_id"])))
    }
    if (error) throw error
  }
  if (input.type === "word_retest") {
    const row = buildWordRetestRow(taskId, input.wordRetest)
    let { error } = await supabase.from("ops_word_retests").upsert(row)
    if (error && isMissingColumnError(error)) {
      ;({ error } = await supabase
        .from("ops_word_retests")
        .upsert(stripMissingMigrationColumns(row, ["teacher_catalog_id"])))
    }
    if (error) throw error
  }
}

function inputFromTask(task: OpsTask, status: OpsTaskStatus = task.status): OpsTaskInput {
  return {
    title: task.title,
    type: task.type,
    status,
    priority: task.priority,
    assigneeId: task.assigneeId,
    secondaryAssigneeId: task.secondaryAssigneeId,
    studentId: task.studentId,
    classId: task.classId,
    textbookId: task.textbookId,
    studentName: task.studentName,
    className: task.className,
    textbookTitle: task.textbookTitle,
    campus: task.campus,
    subject: task.subject,
    dueAt: task.dueAt,
    completedAt: task.completedAt,
    memo: task.memo,
    registration: task.registration,
    withdrawal: task.withdrawal,
    transfer: task.transfer,
    wordRetest: task.wordRetest,
  }
}

function isRegistrationWorkflowComplete(input: OpsTaskInput) {
  const pipelineStatus = text(input.registration?.pipelineStatus)
  return input.status === "done" || pipelineStatus.startsWith("7.")
}

function getMissingRegistrationCheckLabels(registration?: OpsRegistrationDetail) {
  return [
    { checked: Boolean(registration?.admissionNoticeSent), label: "입학안내문" },
    { checked: Boolean(registration?.paymentChecked), label: "수납" },
    { checked: Boolean(registration?.makeeduRegistered), label: "메이크에듀 등록" },
    { checked: Boolean(registration?.makeeduInvoiceSent), label: "청구서 발송" },
    { checked: Boolean(registration?.textbookBillingIssued), label: "교재 청구출고표" },
  ].filter((item) => !item.checked).map((item) => item.label)
}

function getMissingWithdrawalCheckLabels(withdrawal?: OpsWithdrawalDetail) {
  return [
    { checked: Boolean(withdrawal?.makeeduWithdrawalDone), label: "메이크에듀 퇴원처리" },
    { checked: Boolean(withdrawal?.feeProcessed), label: "수업료 처리" },
    { checked: Boolean(withdrawal?.textbookFeeProcessed), label: "교재비 처리" },
  ].filter((item) => !item.checked).map((item) => item.label)
}

function getMissingTransferCheckLabels(transfer?: OpsTransferDetail) {
  return [
    { checked: Boolean(transfer?.makeeduTransferDone), label: "메이크에듀 전반처리" },
    { checked: Boolean(transfer?.feeProcessed), label: "수업료 처리" },
    { checked: Boolean(transfer?.textbookFeeProcessed), label: "교재비 처리" },
  ].filter((item) => !item.checked).map((item) => item.label)
}

function findRegistrationPipelineStatus(prefix: string, fallback = "") {
  return REGISTRATION_PIPELINE_STATUSES.find((status) => text(status.value).startsWith(prefix))?.value || fallback
}

function isClosedRegistrationPipelineStatus(value?: string) {
  const current = text(value)
  return current.startsWith("7.") || current.startsWith("8.") || current.startsWith("9.")
}

function getRegistrationPipelineStatusForTaskStatus(status: OpsTaskStatus, currentPipelineStatus?: string) {
  const current = text(currentPipelineStatus)

  if (status === "done") return findRegistrationPipelineStatus("7.", current)
  if (status === "canceled") return current.startsWith("8.") || current.startsWith("9.") ? current : findRegistrationPipelineStatus("9.", current)
  if (status === "requested") return current.startsWith("0.") ? current : findRegistrationPipelineStatus("0.", current)
  if (status === "confirmed" && isClosedRegistrationPipelineStatus(current)) return findRegistrationPipelineStatus("1.", current)
  if (status === "in_progress" && isClosedRegistrationPipelineStatus(current)) return findRegistrationPipelineStatus("6.", current)
  if (status === "on_hold" && isClosedRegistrationPipelineStatus(current)) return findRegistrationPipelineStatus("4-3.", current)

  return current
}

async function markRegistrationTextbookReady(taskId: string) {
  if (!supabase) return
  const { error } = await supabase
    .from("ops_registration_details")
    .upsert({ task_id: taskId, textbook_ready: true })
  if (error) throw error
  await writeEvent(taskId, "auto_checked", "교재 준비", "", "완료")
}

function getWordRetestDetailStatusForTaskStatus(status: OpsTaskStatus, currentRetestStatus?: string) {
  const current = text(currentRetestStatus)

  if (status === "done") return current === "absent" ? "absent" : "done"
  if (status === "canceled") return "absent"
  if (status === "in_progress") return "in_progress"
  if (status === "requested" || status === "confirmed") return "not_started"
  if (status === "on_hold") return current === "in_progress" ? "in_progress" : current || "not_started"

  return current || "not_started"
}

function hasManagementReference(...values: unknown[]) {
  return values.some((value) => Boolean(text(value)))
}

function hasWordRetestScore(wordRetest?: OpsWordRetestDetail) {
  return [wordRetest?.firstScore, wordRetest?.secondScore, wordRetest?.thirdScore].some((score) => Boolean(text(score)))
}

function isWordRetestAbsent(wordRetest?: OpsWordRetestDetail) {
  return text(wordRetest?.retestStatus) === "absent"
}

function shouldRequireWordRetestScore(wordRetest?: OpsWordRetestDetail) {
  return !isWordRetestAbsent(wordRetest) && !hasWordRetestScore(wordRetest)
}

function inferClassBranch(row: Row | null) {
  const roomText = `${text(row?.room)} ${text(row?.campus)} ${text(row?.branch)}`
  if (roomText.includes("별관")) return "별관"
  if (roomText.includes("본관")) return "본관"
  return ""
}

function isSameManagementReference(first: unknown, second: unknown) {
  const firstValue = text(first)
  const secondValue = text(second)
  return firstValue !== "" && firstValue === secondValue
}

const MANAGEMENT_LINK_FIELDS = new Set(["학생", "수업", "교재", "전 수업", "후 수업", "선생님"])
const MANAGEMENT_INPUT_FIELDS = new Set(["수업시작일", "퇴원일", "전 수업 종료일", "후 수업 시작일", "응시일시", "단원", "점수"])
const MANAGEMENT_CHOICE_FIELDS = new Set(["다른 수업"])

function managementMissingFieldLabel(field: string) {
  if (MANAGEMENT_INPUT_FIELDS.has(field)) return `${field} 입력 필요`
  if (MANAGEMENT_CHOICE_FIELDS.has(field)) return `${field} 선택 필요`
  if (MANAGEMENT_LINK_FIELDS.has(field)) return `${field} 연결 필요`
  return `${field} 확인 필요`
}

function assertManagementSyncReady(input: OpsTaskInput) {
  const missingFields: string[] = []

  if (input.type === "registration" && isRegistrationWorkflowComplete(input)) {
    if (!text(input.registration?.classStartDate)) missingFields.push("수업시작일")
    if (!hasManagementReference(input.studentId, input.studentName)) missingFields.push("학생")
    if (!hasManagementReference(input.classId, input.className)) missingFields.push("수업")
    if (!hasManagementReference(input.textbookId, input.textbookTitle)) missingFields.push("교재")
    getMissingRegistrationCheckLabels(input.registration).forEach((label) => missingFields.push(label))
  }

  if (input.type === "withdrawal" && input.status === "done") {
    if (!text(input.withdrawal?.withdrawalDate)) missingFields.push("퇴원일")
    if (!hasManagementReference(input.studentId, input.studentName)) missingFields.push("학생")
    if (!hasManagementReference(input.classId, input.className)) missingFields.push("수업")
    getMissingWithdrawalCheckLabels(input.withdrawal).forEach((label) => missingFields.push(label))
  }

  if (input.type === "transfer" && input.status === "done") {
    const transfer = input.transfer || {}
    if (!text(transfer.fromClassEndDate)) missingFields.push("전 수업 종료일")
    if (!text(transfer.toClassStartDate)) missingFields.push("후 수업 시작일")
    if (!hasManagementReference(input.studentId, input.studentName)) missingFields.push("학생")
    if (!hasManagementReference(transfer.fromClassId, transfer.fromClassName)) missingFields.push("전 수업")
    if (!hasManagementReference(transfer.toClassId || input.classId, transfer.toClassName || input.className)) {
      missingFields.push("후 수업")
    }
    if (isSameManagementReference(transfer.fromClassId || transfer.fromClassName, transfer.toClassId || input.classId || transfer.toClassName || input.className)) missingFields.push("다른 수업")
    getMissingTransferCheckLabels(input.transfer).forEach((label) => missingFields.push(label))
  }

  if (input.type === "word_retest" && input.status === "done") {
    const wordRetest = input.wordRetest || {}
    if (!hasManagementReference(input.studentId, input.studentName, wordRetest.studentName)) missingFields.push("학생")
    if (!hasManagementReference(input.classId, input.className, wordRetest.className)) missingFields.push("수업")
    if (!hasManagementReference(wordRetest.teacherId, wordRetest.teacherName)) missingFields.push("선생님")
    if (!hasManagementReference(input.textbookId, input.textbookTitle, wordRetest.textbookName)) missingFields.push("교재")
    if (!text(wordRetest.branch)) missingFields.push("지점")
    if (!text(wordRetest.testAt)) missingFields.push("응시일시")
    if (!text(wordRetest.unit)) missingFields.push("단원")
    if (shouldRequireWordRetestScore(wordRetest)) missingFields.push("점수")
  }

  if (missingFields.length > 0) {
    throw new Error(`${getTaskTypeLabel(input.type)} 완료 전: ${missingFields.map(managementMissingFieldLabel).join(", ")}`)
  }
}

async function assertManagementSyncRecordsReady(input: OpsTaskInput) {
  if (input.type === "registration" && isRegistrationWorkflowComplete(input)) {
    const student = hasManagementReference(input.studentId) ? await resolveOpsStudent(input) : null
    const classRow = await resolveOpsClass(input.classId, input.className)
    const textbook = await resolveOpsTextbook(input.textbookId, input.textbookTitle)

    if (hasManagementReference(input.studentId)) assertResolvedManagementRecord(student, "등록 완료 전에 학생 정보를 다시 선택하세요.")
    assertResolvedManagementRecord(classRow, "등록 완료 전에 등록할 수업을 다시 선택하세요.")
    assertResolvedManagementRecord(textbook, "등록 완료 전에 등록 교재를 다시 선택하세요.")
  }

  if (input.type === "withdrawal" && input.status === "done") {
    const student = await resolveOpsStudent(input)
    const classRow = await resolveOpsClass(input.classId, input.className, input.withdrawal?.teacherName)

    assertResolvedManagementRecord(student, "퇴원 완료 전에 기존 학생을 다시 선택하세요.")
    assertResolvedManagementRecord(classRow, "퇴원 완료 전에 기존 수업을 다시 선택하세요.")
    assertOpsStudentInClass(student, classRow, "퇴원 완료 전에 학생이 해당 수업 명단에 있는지 확인하세요.")
  }

  if (input.type === "transfer" && input.status === "done") {
    const transfer = input.transfer || {}
    const student = await resolveOpsStudent(input)
    const fromClass = await resolveOpsClass(transfer.fromClassId, transfer.fromClassName, transfer.fromTeacherName)
    const toClass = await resolveOpsClass(transfer.toClassId || input.classId, transfer.toClassName || input.className, transfer.toTeacherName)

    assertResolvedManagementRecord(student, "전반 완료 전에 기존 학생을 다시 선택하세요.")
    assertResolvedManagementRecord(fromClass, "전반 완료 전에 전 수업을 다시 선택하세요.")
    assertResolvedManagementRecord(toClass, "전반 완료 전에 후 수업을 다시 선택하세요.")
    assertOpsStudentInClass(student, fromClass, "전반 완료 전에 학생이 전 수업 명단에 있는지 확인하세요.")
  }

  if (input.type === "word_retest" && input.status === "done") {
    const wordRetest = input.wordRetest || {}
    const student = await resolveOpsStudent({
      ...input,
      studentName: input.studentName || wordRetest.studentName,
    })
    const classRow = await resolveOpsClass(input.classId, input.className || wordRetest.className, wordRetest.teacherName)
    const textbook = await resolveOpsTextbook(input.textbookId, input.textbookTitle || wordRetest.textbookName)
    const teacher = await resolveOpsTeacher(wordRetest.teacherId, wordRetest.teacherName)

    assertResolvedManagementRecord(student, "단어 재시험 완료 전에 기존 학생을 다시 선택하세요.")
    assertResolvedManagementRecord(classRow, "단어 재시험 완료 전에 기존 수업을 다시 선택하세요.")
    assertResolvedManagementRecord(textbook, "단어 재시험 완료 전에 기존 교재를 다시 선택하세요.")
    assertResolvedManagementRecord(teacher, "단어 재시험 완료 전에 담당 선생님을 다시 선택하세요.")
    assertOpsStudentInClass(student, classRow, "단어 재시험 완료 전에 학생이 해당 수업 명단에 있는지 확인하세요.")
  }
}

function assertResolvedManagementRecord(record: Row | null, message: string): asserts record is Row {
  if (!record) throw new Error(message)
}

function assertCompletedOperationStatusTransition(task: OpsTask, status: OpsTaskStatus) {
  if (task.type !== "general" && task.status === "done" && status !== "done") {
    throw new Error("완료된 운영 업무는 관리 데이터가 반영되어 상태만 되돌릴 수 없습니다.")
  }
}

function assertCompletedOperationEditable(task: OpsTask) {
  if (task.type !== "general" && task.status === "done") {
    throw new Error("완료된 운영 업무는 관리 데이터와 이력이 연결되어 수정할 수 없습니다.")
  }
}

async function selectOpsRowById(table: string, id: string) {
  if (!supabase || !text(id)) return null
  const { data, error } = await supabase.from(table).select("*").eq("id", id).limit(1)
  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) return null
    throw error
  }
  return ((data || []) as unknown as Row[])[0] || null
}

async function findOpsStudentByName(input: OpsTaskInput) {
  if (!supabase) return null
  const studentName = text(input.studentName || input.wordRetest?.studentName)
  if (!studentName) return null

  const { data, error } = await supabase.from("students").select("*").eq("name", studentName).limit(20)
  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) return null
    throw error
  }

  const rows = ((data || []) as unknown as Row[])
  const school = text(input.registration?.schoolName)
  const studentPhone = text(input.registration?.studentPhone)
  return rows.find((row) => (
    (!school || text(row.school) === school) &&
    (!studentPhone || text(row.contact) === studentPhone)
  )) || rows[0] || null
}

async function resolveOpsStudent(input: OpsTaskInput) {
  return await selectOpsRowById("students", input.studentId || "") || await findOpsStudentByName(input)
}

async function ensureOpsStudent(input: OpsTaskInput, existingStudent?: Row | null) {
  if (!supabase) return null
  const existing = existingStudent === undefined ? await resolveOpsStudent(input) : existingStudent
  const studentName = text(input.studentName || input.wordRetest?.studentName || existing?.name)
  if (!studentName) return existing

  const registration = input.registration || {}
  const payload = {
    id: text(existing?.id) || createOpsId(),
    name: studentName,
    school: nullable(registration.schoolName) || nullable(existing?.school),
    grade: nullable(registration.schoolGrade) || nullable(existing?.grade),
    contact: nullable(registration.studentPhone) || nullable(existing?.contact),
    parent_contact: nullable(registration.parentPhone) || nullable(existing?.parent_contact),
    enroll_date: nullableDate(registration.classStartDate) || nullable(existing?.enroll_date) || new Date().toISOString().slice(0, 10),
    status: ACTIVE_STUDENT_STATUS,
    class_ids: normalizeIdList(existing?.class_ids),
    waitlist_class_ids: normalizeIdList(existing?.waitlist_class_ids),
  }

  let result = await supabase.from("students").upsert(payload).select("*").limit(1)
  if (result.error && isMissingColumnError(result.error)) {
    result = await supabase
      .from("students")
      .upsert(stripMissingMigrationColumns(payload, ["status", "class_ids", "waitlist_class_ids"]))
      .select("*")
      .limit(1)
  }
  if (result.error) throw result.error
  return ((result.data || []) as unknown as Row[])[0] || payload
}

async function resolveOpsClass(classId?: string, className?: string, teacherName?: string) {
  if (!supabase) return null
  const byId = await selectOpsRowById("classes", classId || "")
  if (byId) return byId

  const safeName = text(className)
  if (!safeName) return null

  const { data, error } = await supabase.from("classes").select("*").eq("name", safeName).limit(20)
  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) return null
    throw error
  }
  const rows = ((data || []) as unknown as Row[])
  const safeTeacherName = text(teacherName)
  return rows.find((row) => !safeTeacherName || text(row.teacher) === safeTeacherName) || rows[0] || null
}

async function resolveOpsTextbook(textbookId?: string, textbookTitle?: string) {
  if (!supabase) return null
  const byId = await selectOpsRowById("textbooks", textbookId || "")
  if (byId) return byId

  const title = text(textbookTitle)
  if (!title) return null
  const byTitle = await supabase.from("textbooks").select("*").eq("title", title).limit(1)
  if (!byTitle.error && byTitle.data?.length) return (byTitle.data as unknown as Row[])[0]
  if (byTitle.error && !isMissingRelationError(byTitle.error) && !isMissingColumnError(byTitle.error)) throw byTitle.error

  const byName = await supabase.from("textbooks").select("*").eq("name", title).limit(1)
  if (byName.error) {
    if (isMissingRelationError(byName.error) || isMissingColumnError(byName.error)) return null
    throw byName.error
  }
  return ((byName.data || []) as unknown as Row[])[0] || null
}

async function resolveOpsTeacher(teacherId?: string, teacherName?: string) {
  if (!supabase) return null
  const byId = await selectOpsRowById("teacher_catalogs", teacherId || "")
  if (byId) return byId

  const name = text(teacherName)
  if (!name) return null
  const { data, error } = await supabase.from("teacher_catalogs").select("*").eq("name", name).limit(1)
  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) return null
    throw error
  }
  return ((data || []) as unknown as Row[])[0] || null
}

function getOpsStudentClassMode(student: Row | null, classId: string) {
  const safeClassId = text(classId)
  if (!safeClassId) return ""
  if (normalizeIdList(student?.class_ids).includes(safeClassId)) return "enrolled"
  if (normalizeIdList(student?.waitlist_class_ids).includes(safeClassId)) return "waitlist"
  return ""
}

function hasOpsStudentClassRosterLink(student: Row | null, classRow: Row | null) {
  const studentId = text(student?.id)
  const classId = text(classRow?.id)
  if (!studentId || !classId) return false

  return (
    normalizeIdList(student?.class_ids).includes(classId) ||
    normalizeIdList(student?.waitlist_class_ids).includes(classId) ||
    normalizeIdList(classRow?.student_ids).includes(studentId) ||
    normalizeIdList(classRow?.waitlist_ids).includes(studentId)
  )
}

function hasOpsClassTextbookLink(classRow: Row | null, textbookId: string) {
  const safeTextbookId = text(textbookId)
  if (!safeTextbookId) return false
  return normalizeIdList(classRow?.textbook_ids).includes(safeTextbookId)
}

function assertOpsStudentInClass(student: Row | null, classRow: Row | null, message: string) {
  if (!hasOpsStudentClassRosterLink(student, classRow)) throw new Error(message)
}

async function assertOpsRosterLinked(studentId: string, classId: string, message: string) {
  if (!supabase || !studentId || !classId) return
  const [student, classRow] = await Promise.all([
    selectOpsRowById("students", studentId),
    selectOpsRowById("classes", classId),
  ])
  if (!hasOpsStudentClassRosterLink(student, classRow)) throw new Error(message)
}

async function assertOpsRosterUnlinked(studentId: string, classId: string, message: string) {
  if (!supabase || !studentId || !classId) return
  const [student, classRow] = await Promise.all([
    selectOpsRowById("students", studentId),
    selectOpsRowById("classes", classId),
  ])
  if (hasOpsStudentClassRosterLink(student, classRow)) throw new Error(message)
}

async function assertOpsClassTextbookLinked(classId: string, textbookId: string, message: string) {
  if (!supabase || !classId || !textbookId) return
  const classRow = await selectOpsRowById("classes", classId)
  if (!hasOpsClassTextbookLink(classRow, textbookId)) throw new Error(message)
}

async function assertOpsStudentStatus(studentId: string, status: string, message: string) {
  if (!supabase || !studentId || !status) return
  const student = await selectOpsRowById("students", studentId)
  if (text(student?.status) !== status) throw new Error(message)
}

async function restoreOpsStudentRosterSnapshot(studentId: string, student: Row | null) {
  if (!supabase || !studentId || !student) return
  const { error } = await supabase.from("students").update({
    status: text(student.status) || null,
    class_ids: normalizeIdList(student.class_ids),
    waitlist_class_ids: normalizeIdList(student.waitlist_class_ids),
  }).eq("id", studentId)
  if (error && !isMissingColumnError(error)) throw error
}

async function restoreOpsRegistrationStudentSnapshot(studentId: string, student: Row | null) {
  if (!supabase || !studentId || !student) return

  const payload = {
    name: text(student.name),
    school: nullable(student.school),
    grade: nullable(student.grade),
    contact: nullable(student.contact),
    parent_contact: nullable(student.parent_contact),
    enroll_date: nullableDate(student.enroll_date),
    status: text(student.status) || null,
    class_ids: normalizeIdList(student.class_ids),
    waitlist_class_ids: normalizeIdList(student.waitlist_class_ids),
  }

  let result = await supabase.from("students").update(payload).eq("id", studentId)
  if (result.error && isMissingColumnError(result.error)) {
    result = await supabase
      .from("students")
      .update(stripMissingMigrationColumns(payload, ["parent_contact", "enroll_date", "status", "class_ids", "waitlist_class_ids"]))
      .eq("id", studentId)
  }
  if (result.error && !isMissingColumnError(result.error)) throw result.error
}

async function restoreOpsClassRosterSnapshot(classId: string, classRow: Row | null) {
  if (!supabase || !classId || !classRow) return
  const { error } = await supabase.from("classes").update({
    student_ids: normalizeIdList(classRow.student_ids),
    waitlist_ids: normalizeIdList(classRow.waitlist_ids),
  }).eq("id", classId)
  if (error && !isMissingColumnError(error)) throw error
}

async function restoreOpsStudentClassRosterSnapshots(studentId: string, student: Row | null, classId: string, classRow: Row | null) {
  await Promise.allSettled([
    restoreOpsStudentRosterSnapshot(studentId, student),
    restoreOpsClassRosterSnapshot(classId, classRow),
  ])
}

async function restoreOpsClassTextbookSnapshot(classId: string, classRow: Row | null) {
  if (!supabase || !classId || !classRow) return
  const { error } = await supabase.from("classes").update({
    textbook_ids: normalizeIdList(classRow.textbook_ids),
  }).eq("id", classId)
  if (error && !isMissingColumnError(error)) throw error
}

async function deleteOpsRegistrationCreatedStudent(student: Row | null, shouldDelete: boolean) {
  if (!supabase || !shouldDelete) return
  const studentId = text(student?.id)
  if (!studentId) return
  const { error } = await supabase.from("students").delete().eq("id", studentId)
  if (error && !isMissingRelationError(error) && !isMissingColumnError(error)) throw error
}

function throwFirstRejectedRollback(rollbackResults: PromiseSettledResult<unknown>[]) {
  const failedRollback = rollbackResults.find((result) => result.status === "rejected") as PromiseRejectedResult | undefined
  if (failedRollback) throw failedRollback.reason
}

async function rollbackOpsRegistrationCompletionSync(taskId: string, student: Row, classRow: Row, originalStudent: Row | null = null, shouldDeleteCreatedStudent = false) {
  const studentId = text(student.id)
  const classId = text(classRow.id)
  const studentRollback = shouldDeleteCreatedStudent
    ? deleteOpsRegistrationCreatedStudent(student, true)
    : restoreOpsRegistrationStudentSnapshot(studentId, originalStudent || student)
  const rollbackResults = await Promise.allSettled([
    studentRollback,
    restoreOpsClassRosterSnapshot(classId, classRow),
  ])
  throwFirstRejectedRollback(rollbackResults)

  const studentLabel = text(student.name) || studentId
  const classLabel = text(classRow.name) || classId
  await writeAutoSyncEventOnce(taskId, "registration_rollback", `${studentLabel} · ${classLabel}`)
}

async function rollbackOpsTransferCompletionSync(taskId: string, student: Row, fromClass: Row, toClass: Row) {
  const studentId = text(student.id)
  const fromClassId = text(fromClass.id)
  const toClassId = text(toClass.id)
  const rollbackResults = await Promise.allSettled([
    restoreOpsStudentRosterSnapshot(studentId, student),
    restoreOpsClassRosterSnapshot(fromClassId, fromClass),
    restoreOpsClassRosterSnapshot(toClassId, toClass),
  ])
  throwFirstRejectedRollback(rollbackResults)

  const studentLabel = text(student.name) || studentId
  const fromClassLabel = text(fromClass.name) || fromClassId
  const toClassLabel = text(toClass.name) || toClassId
  await writeAutoSyncEventOnce(taskId, "transfer_rollback", `${studentLabel} · ${fromClassLabel} → ${toClassLabel}`)
}

async function rollbackOpsWithdrawalCompletionSync(taskId: string, student: Row, classRow: Row) {
  const studentId = text(student.id)
  const classId = text(classRow.id)
  const rollbackResults = await Promise.allSettled([
    restoreOpsStudentRosterSnapshot(studentId, student),
    restoreOpsClassRosterSnapshot(classId, classRow),
  ])
  throwFirstRejectedRollback(rollbackResults)

  const studentLabel = text(student.name) || studentId
  const classLabel = text(classRow.name) || classId
  await writeAutoSyncEventOnce(taskId, "withdrawal_rollback", `${studentLabel} · ${classLabel}`)
}

async function restoreOpsTaskLinkSnapshot(task: OpsTask) {
  await updateOpsTaskLinkFields(task.id, {
    student_id: nullable(task.studentId),
    student_name: nullable(task.studentName),
    class_id: nullable(task.classId),
    class_name: nullable(task.className),
    textbook_id: nullable(task.textbookId),
    textbook_title: nullable(task.textbookTitle),
    subject: nullable(task.subject),
    assignee_id: nullable(task.assigneeId),
  })
}

async function restoreOpsTaskDetailSnapshot(task: OpsTask) {
  const input = inputFromTask(task, task.status)

  if (task.type === "registration") {
    if (task.registration) {
      await upsertDetail(task.id, input)
    } else {
      await deleteOpsTaskChildRows("ops_registration_details", task.id)
    }
    return
  }

  if (task.type === "withdrawal") {
    if (task.withdrawal) {
      await upsertDetail(task.id, input)
    } else {
      await deleteOpsTaskChildRows("ops_withdrawal_details", task.id)
    }
    return
  }

  if (task.type === "transfer") {
    if (task.transfer) {
      await upsertDetail(task.id, input)
    } else {
      await deleteOpsTaskChildRows("ops_transfer_details", task.id)
    }
    return
  }

  if (task.type === "word_retest") {
    if (task.wordRetest) {
      await upsertDetail(task.id, input)
    } else {
      await deleteOpsTaskChildRows("ops_word_retests", task.id)
    }
  }
}

async function prepareOpsCompletionStatusRollback(task: OpsTask, input: OpsTaskInput): Promise<OpsCompletionRollback | null> {
  if (input.type === "registration" && isRegistrationWorkflowComplete(input)) {
    const originalStudent = await resolveOpsStudent(input)
    const classRow = await resolveOpsClass(input.classId, input.className)
    const shouldDeleteCreatedStudent = !originalStudent

    return async () => {
      const student = await resolveOpsStudent(input)
      if (student && classRow) {
        await rollbackOpsRegistrationCompletionSync(task.id, student, classRow, originalStudent, shouldDeleteCreatedStudent)
      }
      await restoreOpsTaskLinkSnapshot(task)
      await restoreOpsTaskDetailSnapshot(task)
    }
  }

  if (input.type === "withdrawal" && input.status === "done") {
    const student = await resolveOpsStudent(input)
    const classRow = await resolveOpsClass(input.classId, input.className, input.withdrawal?.teacherName)

    return async () => {
      if (student && classRow) {
        await rollbackOpsWithdrawalCompletionSync(task.id, student, classRow)
      }
      await restoreOpsTaskLinkSnapshot(task)
      await restoreOpsTaskDetailSnapshot(task)
    }
  }

  if (input.type === "transfer" && input.status === "done") {
    const transfer = input.transfer || {}
    const student = await resolveOpsStudent(input)
    const fromClass = await resolveOpsClass(transfer.fromClassId, transfer.fromClassName, transfer.fromTeacherName)
    const toClass = await resolveOpsClass(transfer.toClassId || input.classId, transfer.toClassName || input.className, transfer.toTeacherName)

    return async () => {
      if (student && fromClass && toClass) {
        await rollbackOpsTransferCompletionSync(task.id, student, fromClass, toClass)
      }
      await restoreOpsTaskLinkSnapshot(task)
      await restoreOpsTaskDetailSnapshot(task)
    }
  }

  if (input.type === "word_retest" && input.status === "done") {
    return async () => {
      await restoreOpsTaskLinkSnapshot(task)
      await restoreOpsTaskDetailSnapshot(task)
      await syncWordRetestManagementLinks(task.id, inputFromTask(task, task.status))
    }
  }

  return null
}

async function prepareCreatedOpsCompletionSyncRollback(taskId: string, input: OpsTaskInput): Promise<OpsCompletionRollback | null> {
  if (input.status !== "done") return null

  if (input.type === "registration" && isRegistrationWorkflowComplete(input)) {
    const originalStudent = await resolveOpsStudent(input)
    const classRow = await resolveOpsClass(input.classId, input.className)
    const shouldDeleteCreatedStudent = !originalStudent

    return async () => {
      const student = await resolveOpsStudent(input)
      if (student && classRow) {
        await rollbackOpsRegistrationCompletionSync(taskId, student, classRow, originalStudent, shouldDeleteCreatedStudent)
      }
    }
  }

  if (input.type === "withdrawal") {
    const student = await resolveOpsStudent(input)
    const classRow = await resolveOpsClass(input.classId, input.className, input.withdrawal?.teacherName)

    return async () => {
      if (student && classRow) {
        await rollbackOpsWithdrawalCompletionSync(taskId, student, classRow)
      }
    }
  }

  if (input.type === "transfer") {
    const transfer = input.transfer || {}
    const student = await resolveOpsStudent(input)
    const fromClass = await resolveOpsClass(transfer.fromClassId, transfer.fromClassName, transfer.fromTeacherName)
    const toClass = await resolveOpsClass(transfer.toClassId || input.classId, transfer.toClassName || input.className, transfer.toTeacherName)

    return async () => {
      if (student && fromClass && toClass) {
        await rollbackOpsTransferCompletionSync(taskId, student, fromClass, toClass)
      }
    }
  }

  return null
}

async function rollbackAppliedCompletionSync(rollbackCompletionSync: OpsCompletionRollback | null, completionSyncApplied: boolean, originalError: unknown) {
  if (!completionSyncApplied || !rollbackCompletionSync) return

  try {
    await rollbackCompletionSync()
  } catch (rollbackError) {
    attachOpsTaskCleanupError(originalError, rollbackError)
  }
}

async function insertOpsStudentClassHistory(studentId: string, classId: string, action: "enrolled" | "removed", previousMode: string, nextMode: string, memo: string) {
  if (!supabase || !studentId || !classId) return
  const { error } = await supabase.from("student_class_enrollment_history").insert({
    student_id: studentId,
    class_id: classId,
    action,
    previous_mode: nullable(previousMode),
    next_mode: nullable(nextMode),
    memo,
  })
  if (error && !isMissingRelationError(error) && !isMissingColumnError(error)) throw error
}

async function assignOpsStudentToClass(student: Row | null, classRow: Row | null, memo = "ops_task") {
  if (!supabase || !student || !classRow) return
  const studentId = text(student.id)
  const classId = text(classRow.id)
  if (!studentId || !classId) return

  const previousMode = getOpsStudentClassMode(student, classId)
  const studentPatch = {
    status: ACTIVE_STUDENT_STATUS,
    class_ids: addUniqueId(student.class_ids, classId),
    waitlist_class_ids: removeId(student.waitlist_class_ids, classId),
  }
  const classPatch = {
    student_ids: addUniqueId(classRow.student_ids, studentId),
    waitlist_ids: removeId(classRow.waitlist_ids, studentId),
  }

  try {
    const [studentResult, classResult] = await Promise.all([
      supabase.from("students").update(studentPatch).eq("id", studentId),
      supabase.from("classes").update(classPatch).eq("id", classId),
    ])
    if (studentResult.error) throw studentResult.error
    if (classResult.error) throw classResult.error
    await assertOpsRosterLinked(studentId, classId, "수업명단 등록 후 학생과 수업 연결을 확인하지 못했습니다.")
  } catch (error) {
    await restoreOpsStudentClassRosterSnapshots(studentId, student, classId, classRow)
    throw error
  }
  if (previousMode !== "enrolled") {
    await insertOpsStudentClassHistory(studentId, classId, "enrolled", previousMode, "enrolled", memo)
  }
}

async function assignOpsTextbookToClass(classRow: Row | null, textbook: Row | null) {
  if (!supabase || !classRow || !textbook) return
  const classId = text(classRow.id)
  const textbookId = text(textbook.id)
  if (!classId || !textbookId) return

  try {
    const { error } = await supabase
      .from("classes")
      .update({
        textbook_ids: addUniqueId(classRow.textbook_ids, textbookId),
      })
      .eq("id", classId)
    if (error && !isMissingColumnError(error)) throw error
    await assertOpsClassTextbookLinked(classId, textbookId, "등록 교재를 수업에 연결하지 못했습니다.")
  } catch (error) {
    await restoreOpsClassTextbookSnapshot(classId, classRow)
    throw error
  }
}

async function removeOpsStudentFromClass(student: Row | null, classRow: Row | null, memo = "ops_task") {
  if (!supabase || !student || !classRow) return
  const studentId = text(student.id)
  const classId = text(classRow.id)
  if (!studentId || !classId) return

  const previousMode = getOpsStudentClassMode(student, classId)
  try {
    const [studentResult, classResult] = await Promise.all([
      supabase.from("students").update({
        class_ids: removeId(student.class_ids, classId),
        waitlist_class_ids: removeId(student.waitlist_class_ids, classId),
      }).eq("id", studentId),
      supabase.from("classes").update({
        student_ids: removeId(classRow.student_ids, studentId),
        waitlist_ids: removeId(classRow.waitlist_ids, studentId),
      }).eq("id", classId),
    ])
    if (studentResult.error) throw studentResult.error
    if (classResult.error) throw classResult.error
    await assertOpsRosterUnlinked(studentId, classId, "수업명단 제거 후 학생과 수업 연결이 남아 있습니다.")
  } catch (error) {
    await restoreOpsStudentClassRosterSnapshots(studentId, student, classId, classRow)
    throw error
  }
  if (previousMode) {
    await insertOpsStudentClassHistory(studentId, classId, "removed", previousMode, "", memo)
  }
}

async function setOpsStudentStatus(student: Row | null, status: string) {
  if (!supabase || !student || !text(student.id)) return
  const studentId = text(student.id)
  const { error } = await supabase.from("students").update({ status }).eq("id", studentId)
  if (error && !isMissingColumnError(error)) throw error
  await assertOpsStudentStatus(studentId, status, "학생 상태 변경을 확인하지 못했습니다.")
}

async function updateOpsTaskLinkFields(taskId: string, patch: Record<string, OpsTaskLinkPatchValue>) {
  if (!supabase) return
  const nextPatch = Object.fromEntries(
    Object.entries(patch)
      .map(([key, value]) => [key, value === null ? null : text(value)])
      .filter(([, value]) => value === null || Boolean(value)),
  )
  if (Object.keys(nextPatch).length === 0) return
  const { error } = await supabase.from("ops_tasks").update(nextPatch).eq("id", taskId)
  if (error) throw error
}

async function syncRegistrationPipelineStatusForTaskStatus(task: OpsTask, status: OpsTaskStatus) {
  if (!supabase || task.type !== "registration") return

  const pipelineStatus = getRegistrationPipelineStatusForTaskStatus(status, task.registration?.pipelineStatus)
  if (!pipelineStatus || pipelineStatus === text(task.registration?.pipelineStatus)) return

  const { error } = await supabase
    .from("ops_registration_details")
    .upsert({ task_id: task.id, pipeline_status: pipelineStatus })
  if (error) throw error
}

async function syncRegistrationManagementLinks(taskId: string, input: OpsTaskInput) {
  const completed = isRegistrationWorkflowComplete(input)
  const existingStudent = completed ? await resolveOpsStudent(input) : null
  const student = completed ? await ensureOpsStudent(input, existingStudent) : await resolveOpsStudent(input)
  const shouldDeleteCreatedStudent = completed && !existingStudent && Boolean(text(student?.id))
  const classRow = await resolveOpsClass(input.classId, input.className)
  const textbook = await resolveOpsTextbook(input.textbookId, input.textbookTitle)

  await updateOpsTaskLinkFields(taskId, {
    student_id: text(student?.id) || null,
    student_name: text(student?.name) || text(input.studentName) || null,
    class_id: text(classRow?.id) || null,
    class_name: text(classRow?.name) || text(input.className) || null,
    textbook_id: text(textbook?.id) || null,
    textbook_title: text(textbook?.title || textbook?.name) || text(input.textbookTitle) || null,
    subject: text(classRow?.subject) || text(input.subject) || null,
  })

  if (completed) {
    assertResolvedManagementRecord(student, "등록 완료 전에 학생 정보를 입력하세요.")
    assertResolvedManagementRecord(classRow, "등록 완료 전에 등록할 수업을 선택하세요.")
    assertResolvedManagementRecord(textbook, "등록 완료 전에 등록 교재를 선택하세요.")
    const studentLabel = text(student.name) || text(input.studentName)
    const classLabel = text(classRow.name) || text(input.className)
    const textbookLabel = text(textbook.title || textbook.name) || text(input.textbookTitle)
    try {
      await assignOpsStudentToClass(student, classRow, "registration_completed")
      await assignOpsTextbookToClass(classRow, textbook)
      await markRegistrationTextbookReady(taskId)
    } catch (error) {
      try {
        await rollbackOpsRegistrationCompletionSync(taskId, student, classRow, existingStudent, shouldDeleteCreatedStudent)
      } catch (rollbackError) {
        attachOpsTaskCleanupError(error, rollbackError)
      }
      throw error
    }
    await writeAutoSyncEventOnce(taskId, "학생관리", `${studentLabel} 등록`)
    await writeAutoSyncEventOnce(taskId, "수업명단", `${classLabel} 등록 · registration_completed`)
    await writeAutoSyncEventOnce(taskId, "교재 연결", `${textbookLabel} · ${classLabel}`)
  }
}

async function markWithdrawalRosterUpdated(taskId: string) {
  if (!supabase) return
  const { error } = await supabase
    .from("ops_withdrawal_details")
    .upsert({ task_id: taskId, timetable_roster_updated: true })
  if (error) throw error
  await writeEvent(taskId, "auto_checked", "시간표 명단 변경", "", "완료")
}

async function markTransferRosterUpdated(taskId: string) {
  if (!supabase) return
  const { error } = await supabase
    .from("ops_transfer_details")
    .upsert({ task_id: taskId, timetable_roster_updated: true })
  if (error) throw error
  await writeEvent(taskId, "auto_checked", "시간표 명단 변경", "", "완료")
}

async function syncWithdrawalManagementLinks(taskId: string, input: OpsTaskInput) {
  const student = await resolveOpsStudent(input)
  const classRow = await resolveOpsClass(input.classId, input.className, input.withdrawal?.teacherName)

  await updateOpsTaskLinkFields(taskId, {
    student_id: text(student?.id) || null,
    student_name: text(student?.name) || text(input.studentName) || null,
    class_id: text(classRow?.id) || null,
    class_name: text(classRow?.name) || text(input.className) || null,
    subject: text(classRow?.subject) || text(input.subject) || null,
  })

  if (input.status === "done") {
    assertResolvedManagementRecord(student, "퇴원 완료 전에 기존 학생을 연결하세요.")
    assertResolvedManagementRecord(classRow, "퇴원 완료 전에 기존 수업을 연결하세요.")
    assertOpsStudentInClass(student, classRow, "퇴원 완료 전에 학생이 해당 수업 명단에 있는지 확인하세요.")
    const classLabel = text(classRow.name) || text(input.className)
    try {
      await removeOpsStudentFromClass(student, classRow, "withdrawal_completed")
      await setOpsStudentStatus(student, WITHDRAWN_STUDENT_STATUS)
      await markWithdrawalRosterUpdated(taskId)
    } catch (error) {
      try {
        await rollbackOpsWithdrawalCompletionSync(taskId, student, classRow)
      } catch (rollbackError) {
        attachOpsTaskCleanupError(error, rollbackError)
      }
      throw error
    }
    await writeAutoSyncEventOnce(taskId, "수업명단", `${classLabel} 제거 · withdrawal_completed`)
    await writeAutoSyncEventOnce(taskId, "학생 상태", "퇴원")
  }
}

async function syncTransferManagementLinks(taskId: string, input: OpsTaskInput) {
  const transfer = input.transfer || {}
  const student = await resolveOpsStudent(input)
  const fromClass = await resolveOpsClass(transfer.fromClassId, transfer.fromClassName, transfer.fromTeacherName)
  const toClass = await resolveOpsClass(transfer.toClassId || input.classId, transfer.toClassName || input.className, transfer.toTeacherName)

  await updateOpsTaskLinkFields(taskId, {
    student_id: text(student?.id) || null,
    student_name: text(student?.name) || text(input.studentName) || null,
    class_id: text(toClass?.id) || null,
    class_name: text(toClass?.name) || text(transfer.toClassName || input.className) || null,
    subject: text(toClass?.subject) || text(input.subject) || null,
  })

  if (input.status === "done") {
    assertResolvedManagementRecord(student, "전반 완료 전에 기존 학생을 연결하세요.")
    assertResolvedManagementRecord(fromClass, "전반 완료 전에 전 수업을 연결하세요.")
    assertResolvedManagementRecord(toClass, "전반 완료 전에 후 수업을 연결하세요.")
    assertOpsStudentInClass(student, fromClass, "전반 완료 전에 학생이 전 수업 명단에 있는지 확인하세요.")
    const fromClassLabel = text(fromClass.name) || text(transfer.fromClassName)
    const toClassLabel = text(toClass.name) || text(transfer.toClassName || input.className)
    try {
      await removeOpsStudentFromClass(student, fromClass, "transfer_from_class")
      const studentAfterFromRemoval = withoutOpsStudentClass(student, fromClass.id)
      await assignOpsStudentToClass(studentAfterFromRemoval, toClass, "transfer_to_class")
      await setOpsStudentStatus(student, ACTIVE_STUDENT_STATUS)
      await markTransferRosterUpdated(taskId)
    } catch (error) {
      try {
        await rollbackOpsTransferCompletionSync(taskId, student, fromClass, toClass)
      } catch (rollbackError) {
        attachOpsTaskCleanupError(error, rollbackError)
      }
      throw error
    }
    await writeAutoSyncEventOnce(taskId, "수업명단", `${fromClassLabel} 제거 · transfer_from_class → ${toClassLabel} 등록 · transfer_to_class`)
    await writeAutoSyncEventOnce(taskId, "학생 상태", "재원")
  }
}

async function syncWordRetestManagementLinks(taskId: string, input: OpsTaskInput) {
  if (!supabase) return
  const wordRetest = input.wordRetest || {}
  const student = await resolveOpsStudent({
    ...input,
    studentName: input.studentName || wordRetest.studentName,
  })
  const classRow = await resolveOpsClass(input.classId, input.className || wordRetest.className, wordRetest.teacherName)
  const textbook = await resolveOpsTextbook(input.textbookId, input.textbookTitle || wordRetest.textbookName)
  const teacher = await resolveOpsTeacher(wordRetest.teacherId, wordRetest.teacherName)

  if (input.status === "done") {
    assertResolvedManagementRecord(student, "단어 재시험 완료 전에 기존 학생을 연결하세요.")
    assertResolvedManagementRecord(classRow, "단어 재시험 완료 전에 기존 수업을 연결하세요.")
    assertResolvedManagementRecord(textbook, "단어 재시험 완료 전에 기존 교재를 연결하세요.")
    assertResolvedManagementRecord(teacher, "단어 재시험 완료 전에 담당 선생님을 연결하세요.")
    assertOpsStudentInClass(student, classRow, "단어 재시험 완료 전에 학생이 해당 수업 명단에 있는지 확인하세요.")
    await writeAutoSyncEventOnce(
      taskId,
      "단어 재시험 연결",
      [text(student.name), text(classRow.name), text(teacher.name)].filter(Boolean).join(" · "),
    )
  }

  await updateOpsTaskLinkFields(taskId, {
    student_id: text(student?.id) || null,
    student_name: text(student?.name) || text(input.studentName || wordRetest.studentName) || null,
    class_id: text(classRow?.id) || null,
    class_name: text(classRow?.name) || text(input.className || wordRetest.className) || null,
    textbook_id: text(textbook?.id) || null,
    textbook_title: text(textbook?.title || textbook?.name) || text(input.textbookTitle || wordRetest.textbookName) || null,
    subject: text(classRow?.subject) || text(input.subject) || null,
    assignee_id: text(teacher?.profile_id) || text(input.assigneeId) || null,
  })

  const detailPatch = {
    branch: nullable(wordRetest.branch) || inferClassBranch(classRow) || "본관",
    teacher_catalog_id: text(teacher?.id) || nullable(wordRetest.teacherId),
    teacher_name: text(teacher?.name) || nullable(wordRetest.teacherName),
    class_name: text(classRow?.name) || nullable(wordRetest.className || input.className),
    student_name: text(student?.name) || nullable(wordRetest.studentName || input.studentName),
    textbook_name: text(textbook?.title || textbook?.name) || nullable(wordRetest.textbookName || input.textbookTitle),
    test_at: nullableDate(wordRetest.testAt),
    retest_status: getWordRetestDetailStatusForTaskStatus(input.status || "requested", wordRetest.retestStatus),
  }
  const { error } = await supabase.from("ops_word_retests").update(detailPatch).eq("task_id", taskId)
  if (error && !isMissingColumnError(error)) throw error
}

async function syncOpsTaskManagementLinks(taskId: string, input: OpsTaskInput) {
  if (!supabase) return
  assertManagementSyncReady(input)
  if (input.type === "registration") await syncRegistrationManagementLinks(taskId, input)
  if (input.type === "withdrawal") await syncWithdrawalManagementLinks(taskId, input)
  if (input.type === "transfer") await syncTransferManagementLinks(taskId, input)
  if (input.type === "word_retest") await syncWordRetestManagementLinks(taskId, input)
}

async function deleteOpsTaskChildRowsOnFailure(tableName: string, taskId: string) {
  try {
    await deleteOpsTaskChildRows(tableName, taskId)
    return null
  } catch (error) {
    return error
  }
}

async function deleteOpsTaskChildRows(tableName: string, taskId: string) {
  if (!supabase || !text(taskId)) return
  const { error } = await supabase.from(tableName).delete().eq("task_id", taskId)
  if (error && !isMissingRelationError(error) && !isMissingColumnError(error)) throw error
}

async function deleteCreatedOpsTaskOnFailure(taskId: string) {
  if (!supabase || !text(taskId)) return null
  const firstDelete = await supabase.from("ops_tasks").delete().eq("id", taskId)
  if (!firstDelete.error || isMissingRelationError(firstDelete.error) || isMissingColumnError(firstDelete.error)) return null

  const childCleanupErrors = await Promise.all([
    deleteOpsTaskChildRowsOnFailure("ops_task_comments", taskId),
    deleteOpsTaskChildRowsOnFailure("ops_task_events", taskId),
    deleteOpsTaskChildRowsOnFailure("ops_task_attachments", taskId),
    deleteOpsTaskChildRowsOnFailure("ops_registration_details", taskId),
    deleteOpsTaskChildRowsOnFailure("ops_withdrawal_details", taskId),
    deleteOpsTaskChildRowsOnFailure("ops_transfer_details", taskId),
    deleteOpsTaskChildRowsOnFailure("ops_word_retests", taskId),
  ])
  const cleanupError = childCleanupErrors.find(Boolean)
  const retryDelete = await supabase.from("ops_tasks").delete().eq("id", taskId)
  if (retryDelete.error && !isMissingRelationError(retryDelete.error) && !isMissingColumnError(retryDelete.error)) return retryDelete.error
  return cleanupError || null
}

function attachOpsTaskCleanupError(originalError: unknown, cleanupError: unknown) {
  if (!cleanupError || typeof originalError !== "object" || originalError === null) return
  const mutableError = originalError as Row
  mutableError.cleanupError = cleanupError
}

export async function createOpsTask(input: OpsTaskInput) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  assertManagementSyncReady(input)
  await assertManagementSyncRecordsReady(input)

  const { data, error } = await supabase
    .from("ops_tasks")
    .insert(buildTaskRow(input, { completedAtFallback: new Date().toISOString() }))
    .select("id")
    .single()

  if (error) throw error
  const taskId = text((data as Row).id)
  let rollbackCompletionSync: OpsCompletionRollback | null = null
  let completionSyncApplied = false
  try {
    await writeManualCheckEvents(taskId, input)
    await upsertDetail(taskId, input)
    rollbackCompletionSync = await prepareCreatedOpsCompletionSyncRollback(taskId, input)
    await syncOpsTaskManagementLinks(taskId, input)
    completionSyncApplied = true
    await writeEvent(taskId, "created", "type", "", input.type)
    clearOpsTaskWorkspaceDataCache()
    return taskId
  } catch (error) {
    await rollbackAppliedCompletionSync(rollbackCompletionSync, completionSyncApplied, error)
    const cleanupError = await deleteCreatedOpsTaskOnFailure(taskId)
    attachOpsTaskCleanupError(error, cleanupError)
    throw error
  }
}

export async function updateOpsTask(taskId: string, input: OpsTaskInput) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const nextStatus = input.status || "requested"
  const existingTask = await loadOpsTaskById(taskId)
  if (!existingTask) throw new Error("업무 데이터를 다시 불러오세요.")
  assertCompletedOperationStatusTransition(existingTask, nextStatus)
  assertCompletedOperationEditable(existingTask)
  assertManagementSyncReady(input)
  await assertManagementSyncRecordsReady(input)

  if (nextStatus === "done") {
    let rollbackCompletionSync: OpsCompletionRollback | null = null
    let completionSyncApplied = false

    await writeManualCheckEvents(taskId, input)
    await upsertDetail(taskId, input)
    rollbackCompletionSync = await prepareOpsCompletionStatusRollback(existingTask, input)
    try {
      await syncOpsTaskManagementLinks(taskId, input)
      completionSyncApplied = true
    } catch (error) {
      await rollbackAppliedCompletionSync(rollbackCompletionSync, true, error)
      throw error
    }

    const { data, error } = await supabase
      .from("ops_tasks")
      .update(buildTaskRow(input, { preserveManagementLinks: true, completedAtFallback: new Date().toISOString() }))
      .eq("id", taskId)
      .select("id")

    if (error || !didMutateOpsTask(data)) {
      await rollbackAppliedCompletionSync(rollbackCompletionSync, completionSyncApplied, error)
      if (error) throw error
      throw new Error("업무 데이터를 다시 불러오세요.")
    }
    await writeEvent(taskId, "updated", "task", "", input.title)
    clearOpsTaskWorkspaceDataCache()
    return
  }

  const { data, error } = await supabase
    .from("ops_tasks")
    .update(buildTaskRow(input))
    .eq("id", taskId)
    .select("id")

  if (error) throw error
  if (!didMutateOpsTask(data)) throw new Error("업무 데이터를 다시 불러오세요.")
  await writeManualCheckEvents(taskId, input)
  await upsertDetail(taskId, input)
  await syncOpsTaskManagementLinks(taskId, input)
  await writeEvent(taskId, "updated", "task", "", input.title)
  clearOpsTaskWorkspaceDataCache()
}

export async function updateOpsTaskStatus(task: OpsTask, status: OpsTaskStatus) {
  let rollbackCompletionSync: OpsCompletionRollback | null = null
  let completionSyncApplied = false
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  const currentTask = await loadOpsTaskById(task.id)
  if (!currentTask) throw new Error("업무 데이터를 다시 불러오세요.")
  assertCompletedOperationStatusTransition(currentTask, status)

  if (status === "done") {
    const nextInput = inputFromTask(currentTask, status)
    await assertManagementSyncRecordsReady(nextInput)
    rollbackCompletionSync = await prepareOpsCompletionStatusRollback(currentTask, nextInput)
    try {
      await syncOpsTaskManagementLinks(currentTask.id, nextInput)
      completionSyncApplied = true
    } catch (error) {
      await rollbackAppliedCompletionSync(rollbackCompletionSync, true, error)
      throw error
    }
  }

  const { data, error } = await supabase
    .from("ops_tasks")
    .update({
      status,
      completed_at: status === "done" ? new Date().toISOString() : null,
    })
    .eq("id", currentTask.id)
    .select("id")

  if (error || !didMutateOpsTask(data)) {
    await rollbackAppliedCompletionSync(rollbackCompletionSync, completionSyncApplied, error)
    if (error) throw error
    throw new Error("업무 데이터를 다시 불러오세요.")
  }
  if (currentTask.type === "word_retest" && status !== "done") {
    const nextInput = inputFromTask(currentTask, status)
    await syncWordRetestManagementLinks(currentTask.id, nextInput)
  }
  if (currentTask.type === "registration") await syncRegistrationPipelineStatusForTaskStatus(currentTask, status)
  await writeEvent(currentTask.id, "status_changed", "status", currentTask.status, status)
  clearOpsTaskWorkspaceDataCache()
}

export async function deleteOpsTask(taskId: string) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  await assertOpsTaskExists(taskId)
  const { data, error } = await supabase.from("ops_tasks").delete().eq("id", taskId).select("id")
  if (error) throw error
  if (!didMutateOpsTask(data)) throw new Error("업무 데이터를 다시 불러오세요.")
  clearOpsTaskWorkspaceDataCache()
}

export async function addOpsTaskComment(taskId: string, body: string) {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  await assertOpsTaskExists(taskId)
  const { data, error } = await supabase
    .from("ops_task_comments")
    .insert({ task_id: taskId, body })
    .select("id,task_id,author_id,body,created_at")
    .single()
  if (error) throwIfMissingOpsTaskReference(error)

  clearOpsTaskWorkspaceDataCache()
  const row = data as Row
  return {
    id: text(row.id),
    taskId: text(row.task_id),
    authorId: text(row.author_id),
    authorLabel: "",
    body: text(row.body),
    createdAt: text(row.created_at),
  } satisfies OpsTaskComment
}

export async function addOpsTaskAttachment(taskId: string, fileName: string, driveLink: string, fileKind = "link") {
  if (!supabase) throw new Error("Supabase 연결 설정이 필요합니다.")
  await assertOpsTaskExists(taskId)
  const { data, error } = await supabase
    .from("ops_task_attachments")
    .insert({
      task_id: taskId,
      file_name: fileName,
      file_kind: fileKind,
      drive_link: driveLink,
    })
    .select("id,task_id,file_name,file_kind,drive_file_id,drive_link,uploaded_by,uploaded_at")
    .single()
  if (error) throwIfMissingOpsTaskReference(error)

  clearOpsTaskWorkspaceDataCache()
  const row = data as Row
  return {
    id: text(row.id),
    taskId: text(row.task_id),
    fileName: text(row.file_name),
    fileKind: text(row.file_kind),
    driveFileId: text(row.drive_file_id),
    driveLink: text(row.drive_link),
    uploadedBy: text(row.uploaded_by),
    uploadedByLabel: "",
    uploadedAt: text(row.uploaded_at),
  } satisfies OpsTaskAttachment
}

export { getOpsTaskCalendarItems, summarizeOpsTasks }
